# Profile default branding forward fix

## Historical provenance

Production's `20260822150000_create_profiles` recorded 15 statements with
MD5 `61a5f6f9afd5341d047b40fd318cb390` (concatenated recorded statements).
Repository/local had changed two `Pawday user` literals to `HomeyPaw user`:
one in `handle_new_user`, one in the initial profile backfill. No other executable
SQL differed. The repository historical file is restored to the executed version.
It must not be replayed against Production or the existing development database.

`20260929105408_profile_default_branding.sql` replaces only `handle_new_user`'s
future fallback. Existing display names are not updated. Custom metadata names,
email fallback, locale selection, idempotent insertion, Auth trigger wiring,
function owner, ACLs, SECURITY DEFINER and empty search_path are preserved.

The forward migration has no dependency on Chat Push, Recurrence V2 or Read
Receipts and naturally follows their timestamps. Those three files are untouched.
Existing local history continues to record the SQL actually executed there;
do not rewrite its earlier HomeyPaw statements or fabricate history entries.
The standard CLI applies only the new forward migration to that database.

The forward migration was persistently applied to local development with
`supabase migration up --local` on 2026-09-29. History contains 43 versions and
only the new branding version was added. All 29 business/config table
fingerprints, earlier history, function definition/owner/ACL/OID and Auth trigger
were unchanged. All 11 pending development Push jobs remained unchanged.

## Verification

`npm run verify:profile-branding` has no remote URL/token override. It uses only
`supabase_db_pawday`, copies schema without business data into two disposable
databases, and checks:

- Exact historical statement hash and immutable hashes of the three release files.
- Fresh application-schema replay in timestamp order using real Supabase managed
  schemas, followed by the forward migration.
- Existing-local schema clone plus the forward migration alone.
- Equal final function definition/security state across both paths.
- Existing synthetic profile rows unchanged; future default, custom name and
  email fallback remain correct; owner, ACL, search_path and trigger are retained.
- Both scratch databases removed and persistent development data/functions/
  migration history/outbox/release config fingerprints unchanged.

## Production read-only backup check — 2026-09-29

Ref: `tknaobmlwmodsqtpqwkr`. Organization metadata explicitly reports `free` /
`tier_free`. Backup list returns `pitr_enabled=false`, `backups=null`,
`physical_backup_data={}`, and `walg_enabled=true`. No successful backup
timestamp, status, recoverable interval or retention interval was returned.
WAL archival is not evidence of recoverability.

**MANUAL DASHBOARD CHECK REQUIRED**:

[Database > Backups](https://supabase.com/dashboard/project/tknaobmlwmodsqtpqwkr/database/backups):
check the Scheduled Backups list for a latest completed backup, timestamp,
retention and restore availability. In Point in Time, confirm enabled status,
earliest/latest recovery points and configured retention. Do not start a restore.

If no recoverable backup is available, arrange a separately authorized manual
schema/data/role export to an access-restricted, encrypted location outside the
repository and validate restore in an isolated environment. Never commit it or
publish it. This task does not create/download a Production dump or enable PITR.
Database backup covers Storage metadata, not the media object bytes; any object
backup requires a separate decision. See [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

The branding fix can be reviewed/committed after local checks pass. Production
backend rollout remains NO-GO until recoverable backup readiness is confirmed.
