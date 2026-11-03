# Independent Production backup and recovery preparation

2026-11-03 acceptance: independent encrypted Database and Storage backups and
integrity checks **PASS**. Isolated local PostgreSQL restoration is **PARTIAL**:
managed-role ownership/grant handling was adapted for the local target, and hosted
Auth/Storage/Edge/JWT/provider/SMTP/Vault-root recovery was not fully exercised.
Do not describe this as a complete disaster-recovery PASS. Two verified encrypted
copies exist on the same physical disk; an independent-device copy is still an
operational follow-up. Private archives, manifests, keys and detailed evidence
remain outside Git. The procedures below are reusable templates, not authorization
or an instruction to repeat the completed export during release synchronization.

Works without Pro. Physical project identity is `tknaobmlwmodsqtpqwkr`; the display
name, current CLI link or a database environment marker alone is insufficient.
Scope all exports to HomeyPaw only. Do not open OrderMori source/configuration or
export its project/account data. Shared Apple Sandbox Tester history/settings are
outside this backup and must never be reset or changed. An unverified OrderMori
dependency blocks HomeyPaw Sandbox shutdown/transfer; see the current release
runbook. The HomeyPaw backup does not establish that independence.

## Minimum recoverable set on Free

1. A complete, consistent PostgreSQL logical archive plus required custom role/
   privilege definitions, accepted source/58-version manifest, backup timestamps,
   tool versions, exit codes, size, SHA-256 and `pg_restore --list` result. Cover
   `public`, `private`, `auth` users/password hashes/identities, Storage metadata,
   Billing state/inbox/subscriptions/entitlements and migration history explicitly.
   An ordinary CLI schema dump may exclude managed schemas; a file that exists is
   not proof of coverage. Do not strip ACLs/roles from the sole recovery copy.
2. Independent **Storage binary objects**, all buckets including avatars, with an
   encrypted manifest of bucket/path/object ID/size/content type/ETag/updated time
   and local SHA-256. The earlier audit counted 946 objects, 512.98 MiB; use fresh
   inventory at execution, not those numbers as a required current count.
3. Protected configuration recovery material: Auth redirect/providers/settings,
   custom role grants/RLS/triggers/extensions, Functions source and versions,
   secrets held in the existing password manager, Vault encryption-root recovery
   procedure and Cron definitions/state. Exporting Vault ciphertext alone does
   not ensure it is decryptable in another project. Follow Supabase's supported
   root-key recovery process; do not print/copy it into this repository.
4. One successfully restored **isolated** copy, with external network/Cron/email
   delivery disabled and no Production/Sandbox service credentials. Check data
   fingerprints/counts/relationships and representative media byte checks. No
   complete backup/restore PASS may be claimed until this independently succeeds.

Use an already encrypted local volume (0700 directory, umask 077, files 0600) and
a second encrypted offline copy. Keep encryption recovery keys separately in the
password manager. Do not use Git, public buckets, CI artifacts or third-party
cloud uploads for private exports. No new backup service/payment is required.

## Future database export — separate authorization required

Read official Production Connect details and CA, verify TLS hostname/project/admin
identity and protected connection file permissions. Direct or **Session** Pooler
5432 is acceptable after verification; do not infer Production's pooler from
Sandbox, use 6543, turn off certificate checks or expose a URL/password on argv.
Use matching PostgreSQL 17 client tools. A password must live in a protected
PGPASSFILE/password manager, not the commands below. Clear inherited PG connection
overrides before using a reviewed `PGSERVICEFILE`/`PGSERVICE` connection profile.

Illustrative export commands, **not executed**; `$BACKUP_DIR` must be an absolute
directory on the protected encrypted volume. The validated connection profile
must choose Production and verify-full TLS; it must not use a default CLI link.

```sh
umask 077
pg_dump --dbname=postgres --format=custom --file="$BACKUP_DIR/database.dump"
pg_dumpall --database=postgres --roles-only --no-role-passwords --file="$BACKUP_DIR/roles.sql"
pg_restore --list "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database.toc"
shasum -a 256 "$BACKUP_DIR/database.dump" "$BACKUP_DIR/roles.sql" > "$BACKUP_DIR/SHA256SUMS"
```

No connection string is embedded. `PGSERVICE`/TLS/PGPASSFILE selection is an
independently reviewed prerequisite, not filled by this preparation task. Abort
on any nonzero exit, permission error, missing required table/data section or
unexpected target. Do not silently omit a schema to make a failing dump pass.
`--no-role-passwords` omits database-role credentials, not application Auth user
password hashes; preserve custom grants and recreate database credentials from
secure configuration at restore. Review managed-role ownership/extension handling
against the target Supabase base rather than overwriting platform-owned roles.

Check archive coverage for critical TABLE DATA sections, not only schema names:
Auth users/identities, all user tables, private Billing/media accounting and
`supabase_migrations.schema_migrations`, plus Storage object/bucket metadata. The
archive must be readable and nonempty. Record snapshot time, archive hash and
protected table-count/fingerprint report without printing business contents.

## Storage export and completeness

- Through an approved read-only Storage API/S3 client, paginate every bucket/object
  inventory and download each object to the encrypted directory. Existing trusted
  admin credentials stay external. S3 access-key creation is a separate cloud
  permission if no existing key is available; do not create one in preparation.
- Preserve exact paths and object IDs in the manifest. Do not use a destructive
  `sync --delete`, overwrite the only previous backup or assume object ETag equals
  a cryptographic checksum. Compute SHA-256 from downloaded bytes.
- Verify exact inventory coverage and each byte length/hash. A permission error,
  interrupted page/download, missing object, changed ETag or concurrent deletion
  makes the backup incomplete; retain previous copies and retry the delta.
- Database and binary Storage snapshots are not atomic. Compare the DB snapshot's
  expected objects to before/after inventory and detect concurrent changes. If a
  consistent recoverable set cannot be established, mark PARTIAL and stop launch
  acceptance. Do not put 1.3.0 behind a global Lock just to make export easier;
  any bounded media-only maintenance window needs separate authorization.
- Restore validation belongs in an isolated Supabase-compatible target: restore
  managed/application schema and data by the supported process, restore binaries
  with matching metadata, then verify object IDs/ledger references, RLS/ownership,
  Auth records and actual media bytes. Do not assume re-uploading creates the same
  IDs. No restore command should ever target Production merely as a test.

## Low-cost schedule and retention

Take one complete DB+Storage baseline before activation and retain a second
encrypted copy. Export DB daily while active; after schema/config changes take
another baseline. Fetch Storage **new/changed objects incrementally**, retain
deleted/older versions with the matching DB snapshot, and verify the manifest.
Suggested initial retention: seven daily DB snapshots and the last two verified
complete media sets/deltas, subject to available encrypted disk and privacy policy.
RPO is the last successful capture (potentially 24 hours), not zero data loss.

A first 513 MiB media download consumes about 0.54 GB of egress plus database and
protocol traffic. Repeating it daily can exceed Free's 5 GB/month; budget exports,
restore downloads and user traffic together. Never assume backup traffic is free
or silently drop incremental coverage to fit the quota. Review the budget daily;
choose a smaller verified delta/export cadence or approve expansion before limits.

## If Pro is approved later

Check the exact Production organization plan and Database -> Backups: a new
successful daily backup must actually appear, with timestamp, retention, status
and restoration availability. Pro's seven-day daily backups do not appear simply
because payment succeeded. Hosted DB backups exclude Storage binaries; retain
independent object preservation and configuration/Vault recovery evidence.

## Incident stop-loss

Pause new checkout with `release_ready=false` under separate authorization; keep
lifecycle Billing/Webhook/Recovery and normal writes alive for paid users. For
capacity pressure approve expansion or a narrowly scoped new-media restriction;
do not delete existing photos/video or alter subscription truth to reclaim space.
Do not restore an old DB over new Apple transactions. A real restore needs its
own approved incident plan: isolated recovery, a record of post-backup mutations,
trusted provider replay/current-state reconciliation and media-delta handling.
Never reset the 360-hour transition clock. If recovery proof fails, remain NO-GO.

References: [Supabase backups](https://supabase.com/docs/guides/platform/backups),
[logical backup/restore and encryption root](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[Storage downloads](https://supabase.com/docs/guides/storage/management/download-objects),
[Storage S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility).
