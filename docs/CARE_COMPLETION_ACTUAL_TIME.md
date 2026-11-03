# Schedule actual care time

Develop implementation, 2026-10-14. Production is unchanged.

The existing Schedule completion wrapper calls `complete_care_task`, which inserts
a Care Log and a completion atomically. It used the server completion clock for
both the actual care time and the completion audit time. Home already displayed
`care_logs.occurred_at`, so late registration looked like late care.

The three timestamps now have explicit responsibilities:

| Meaning                     | Existing canonical field                                                        |
| --------------------------- | ------------------------------------------------------------------------------- |
| Planned occurrence identity | `care_shift_tasks.source_scheduled_for` / `care_task_completions.scheduled_for` |
| Actual care fact            | `care_logs.occurred_at`; `local_date` derived in the task's stored `time_zone`  |
| Registration audit          | Server `care_task_completions.completed_at` and `care_logs.created_at`          |

No new timestamp columns, no historical backfill and no inferred historical care
times. Old timestamps remain as recorded; their true historical occurrence cannot
be reconstructed from the completion click.

The forward migration adds `complete_care_task_v2` and
`complete_care_shift_task_v2`. Both use canonical `family_members`, shared
membership locks and the existing task/shift row locks and occurrence uniqueness.
Authenticated Owner/Member can complete; Viewer, Removed and cross-Family users
cannot. An explicit actual timestamp must be finite and no later than the server clock.
The server-now correction migration treats `care_occurred_at = NULL` as just now,
using `clock_timestamp()` after acquiring completion locks. Schedule sends NULL
for both just-now selection and near-time one-click completion; no modal-open or
client clock snapshot is saved. Planned/custom choices still send exact timestamps.
The just-now subtitle explains that the confirmation time is recorded. The first completed fact wins; a repeated request returns the original
completion and cannot replace its actual time. Existing legacy RPC definitions,
recurrence validation and canceled-state checks are retained.

Schedule offers one-click completion within an inclusive 30-minute distance from
the plan. Outside that window the existing completion sheet requires an explicit
choice: planned, just now or a custom actual date/time. Future planned time is
disabled. It edits the care fact, never the plan. Native DateTimePicker uses the
task's timezone; the web fallback uses the existing recurrence conversion utility,
including DST gap rejection and deterministic overlap resolution.

Home's new `get_today_care_logs` read RPC uses each fact's recorded timezone for
today and retains existing Care RLS, ordering and the 20-record limit. Care history
still sorts by `occurred_at` and groups by `local_date`. Existing author-only Care
edit updates actual time, preserves the record timezone and leaves completion and
planned identity intact. Future/infinite edits are rejected server-side.

The Care insert still triggers one existing Family activity/outbox event. Editing
or retrying completion does not enqueue another insert event. No worker is run by
the verifiers. Reminder completion UI continues to use the legacy interface;
recurrence, notification planning, Journal and Chat are unchanged.

Rollout: apply both forward migrations before publishing the capable client. Old
clients retain their existing completion behavior, which records the completion
clock as the care time. Do not change minimum-version gates during development.

Verification: `verify:care-completion-time` exercises real client adapter and modal
with mocks; `verify:care-completion-time-sql` clones the local schema into a
disposable DB, tests transactional fixtures and real concurrent sessions, drops
the scratch DB and checks the persistent local fingerprint. No Production URL,
password, linked-project option or remote environment override is supported.

Manual acceptance remains required for native picker interactions, confirmation
layout, near-time one-click completion and Home/history after cross-date catch-up.
