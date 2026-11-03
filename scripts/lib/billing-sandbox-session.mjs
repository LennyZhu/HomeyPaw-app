// Operator tooling only. No Edge runtime imports, linked project or dotenv.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
} from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import {
  checkSandboxDeployment,
  sandboxRef,
} from '../../supabase/functions/_shared/family-billing-target.mjs';

export const yearlyVersion = '20261031141904';
export const yearlyName = 'family_billing_yearly_abandonment';
export const yearlySha256 =
  '9431e8e34c144d4b747825e70a3a8373aa6f2c7d78febdb2c75cfd1c63bfb2a6';
export const historyFingerprint = 'e83a633011fc81a4050248c7fcc58e7d';
// Public CA downloaded from the Sandbox Dashboard's Database Settings link.
export const caSha256 =
  '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const root = new URL('../../', import.meta.url);
const deny = () => {
  throw new Error('BILLING_SANDBOX_SESSION_DENIED');
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

export function readProtectedExternal(path) {
  if (!isAbsolute(path) || realpathSync(path) !== path) deny();
  const rel = relative(root.pathname, path);
  if (!rel.startsWith('../') && rel !== '..') deny();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o600
    )
      deny();
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

// Every executable connection path, including legacy Direct manifests, uses
// verify-full and a pinned CA. URL/PG environment overrides never reach libpq.
export function sandboxPsqlInvocation(
  config,
  confirmedRef,
  caFile,
  sql,
  authorizedMigrationVersion,
) {
  checkSandboxDeployment(config, confirmedRef);
  if (confirmedRef !== sandboxRef) deny();
  if (
    authorizedMigrationVersion !== undefined &&
    (authorizedMigrationVersion !== yearlyVersion ||
      sql !== buildYearlyMigrationTransaction())
  )
    deny();
  const db = new URL(config.databaseUrl);
  if (
    db.searchParams.has('sslrootcert') &&
    db.searchParams.get('sslrootcert') !== caFile
  )
    deny();
  const ca = readProtectedExternal(caFile);
  if (digest(ca) !== caSha256) deny();
  const password = decodeURIComponent(db.password);
  if (/[\0\r\n]/.test(password)) deny();
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'LANG', 'TMPDIR']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    PGPASSWORD: password,
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: '/dev/stdin',
    PGCONNECT_TIMEOUT: '10',
    PGGSSENCMODE: 'disable',
    // Also override these inside Docker, whose environment is separate from
    // the operator process. A container service/hostaddr must not redirect us.
    PGSERVICEFILE: '/dev/null',
    PGPASSFILE: '/dev/null',
    PGOPTIONS: `-c default_transaction_read_only=${authorizedMigrationVersion === undefined ? 'on' : 'off'} -c statement_timeout=10000 -c lock_timeout=800 -c idle_in_transaction_session_timeout=10000`,
  });
  return {
    command: 'docker',
    args: [
      'exec',
      '-i',
      ...Object.keys(env)
        .filter((key) => key.startsWith('PG'))
        .flatMap((key) => ['--env', key]),
      'supabase_db_pawday',
      'env',
      '-u',
      'PGHOSTADDR',
      '-u',
      'PGSERVICE',
      'psql',
      '-X',
      '-w',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '--host',
      db.hostname,
      '--port',
      '5432',
      '--username',
      decodeURIComponent(db.username),
      '--dbname',
      'postgres',
      '-c',
      sql,
    ],
    options: {
      env,
      input: ca,
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 8 * 1024 * 1024,
    },
  };
}

const fingerprintSql = `select md5(string_agg(row(version,name,statements)::text,',' order by version)) from supabase_migrations.schema_migrations`;
export const identityGuard = `
do $identity$ begin
  if current_database()<>'postgres' or session_user<>'postgres' or current_user<>'postgres'
    or (select environment from private.family_billing_config where singleton) is distinct from 'SANDBOX'
    or not pg_has_role(session_user,'postgres','MEMBER')
    or not has_schema_privilege(current_user,'private','CREATE')
    or not has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT') then
    raise exception 'SANDBOX_DATABASE_IDENTITY_DENIED'; end if;
  perform private.assert_family_billing_app_review_maintenance();
end; $identity$;`;
const historyGuard = `
do $history$ begin
  if (select count(*) from supabase_migrations.schema_migrations)<>59
    or (${fingerprintSql}) is distinct from '${historyFingerprint}'
    or exists(select 1 from supabase_migrations.schema_migrations where version='${yearlyVersion}') then
    raise exception 'SANDBOX_MIGRATION_HISTORY_DENIED'; end if;
end; $history$;`;

export function readYearlySource() {
  const sql = readFileSync(
    new URL(
      `supabase/sandbox-migrations/${yearlyVersion}_${yearlyName}.sql`,
      root,
    ),
    'utf8',
  );
  if (digest(sql) !== yearlySha256) deny();
  return sql;
}

// CLI History can omit comments/delimiters. Require every non-comment byte of
// the original to be accounted for, so appended local SQL is not overlooked.
export function matchesHistorySource(original, statements) {
  const trivia = (value) => {
    let index = 0;
    while (index < value.length) {
      if (/[\s;]/.test(value[index])) {
        index++;
        continue;
      }
      if (value.startsWith('--', index)) {
        const end = value.indexOf('\n', index + 2);
        index = end < 0 ? value.length : end + 1;
        continue;
      }
      if (value.startsWith('/*', index)) {
        let depth = 1;
        index += 2;
        while (index < value.length && depth) {
          if (value.startsWith('/*', index)) {
            depth++;
            index += 2;
          } else if (value.startsWith('*/', index)) {
            depth--;
            index += 2;
          } else index++;
        }
        if (depth) return false;
        continue;
      }
      return false;
    }
    return true;
  };
  let offset = 0;
  for (const statement of statements) {
    if (typeof statement !== 'string' || !statement.trim()) return false;
    const index = original.indexOf(statement.trim(), offset);
    if (index < 0 || !trivia(original.slice(offset, index))) return false;
    offset = index + statement.trim().length;
  }
  return trivia(original.slice(offset));
}

export function verifyHistorySources(history) {
  if (
    !Array.isArray(history) ||
    history.length !== 59 ||
    new Set(history.map((row) => row.version)).size !== 59
  )
    deny();
  const sources = new Map();
  let sandboxVersions;
  for (const dir of ['supabase/migrations/', 'supabase/sandbox-migrations/']) {
    const files = readdirSync(new URL(dir, root)).filter((file) =>
      file.endsWith('.sql'),
    );
    if (dir.includes('sandbox-'))
      sandboxVersions = files.map((file) => file.split('_')[0]);
    for (const file of files) {
      const version = file.split('_')[0];
      if (sources.has(version)) deny();
      sources.set(version, new URL(dir + file, root));
    }
  }
  for (const row of history) {
    if (
      !sources.has(row.version) ||
      !Array.isArray(row.statements) ||
      !row.statements.length
    )
      deny();
    const path = sources.get(row.version);
    if (path.pathname.split('/').at(-1) !== `${row.version}_${row.name}.sql`)
      deny();
    const original = readFileSync(path, 'utf8');
    if (!matchesHistorySource(original, row.statements)) deny();
  }
  const pending = sandboxVersions.filter(
    (version) => !history.some((row) => row.version === version),
  );
  if (pending.length !== 1 || pending[0] !== yearlyVersion) deny();
  readYearlySource();
  return pending;
}

export function previewSandboxSession(config, confirmedRef, caFile) {
  const marker = randomBytes(16).toString('hex');
  const sql = `begin read only; ${identityGuard} ${historyGuard}
    do $$ begin perform set_config('homeypaw.session_probe','${marker}',false); end; $$;
    select pg_advisory_xact_lock(1947382061,${Math.floor(Math.random() * 2147483647)});
    select jsonb_build_object('phase',1,'pid',pg_backend_pid(),'read_only',current_setting('transaction_read_only'),
      'lock_held',exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted),
      'history',(select jsonb_agg(to_jsonb(h) order by version) from supabase_migrations.schema_migrations h));
    commit;
    begin read only; ${identityGuard}
    select jsonb_build_object('phase',2,'pid',pg_backend_pid(),'read_only',current_setting('transaction_read_only'),
      'marker_preserved',current_setting('homeypaw.session_probe',true)='${marker}',
      'lock_released',not exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory'));
    rollback;`;
  const invocation = sandboxPsqlInvocation(config, confirmedRef, caFile, sql);
  const result = spawnSync(
    invocation.command,
    invocation.args,
    invocation.options,
  );
  // Suppress raw subprocess errors/output: never echo a credential or URI.
  if (result.status !== 0 || result.error) deny();
  const rows = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
  if (
    rows.length !== 2 ||
    rows[0].phase !== 1 ||
    rows[1].phase !== 2 ||
    rows[0].pid !== rows[1].pid ||
    rows.some((row) => row.read_only !== 'on') ||
    !rows[0].lock_held ||
    !rows[1].lock_released ||
    !rows[1].marker_preserved
  )
    deny();
  const pending = verifyHistorySources(rows[0].history);
  return {
    status: 'READ_ONLY_PREVIEW_PASS',
    projectRef: confirmedRef,
    remoteIdentityVerified: true,
    tls: 'verify-full',
    singleSession: true,
    transactionLockReleased: true,
    historyCount: 59,
    historyContentsMatch: true,
    pending,
    migrationSha256: yearlySha256,
    writesAuthorized: false,
    migrationExecuted: false,
  };
}

// Build only; there is deliberately no cloud apply command in this module.
// Preserve the pinned original file byte-for-byte. In its execution copy insert
// guards after BEGIN and History before COMMIT, so schema + History are atomic.
export function buildYearlyMigrationTransaction() {
  const original = readYearlySource();
  const begin = original.indexOf('\nbegin;\n');
  const commit = original.lastIndexOf('\ncommit;\n');
  if (
    begin < 0 ||
    commit < begin ||
    commit + '\ncommit;\n'.length !== original.length
  )
    deny();
  const guard = `
    set local lock_timeout='800ms'; set local statement_timeout='10s';
    set local idle_in_transaction_session_timeout='10s';
    ${identityGuard}
    lock table supabase_migrations.schema_migrations in exclusive mode;
    ${historyGuard}
    do $closed$ begin
      perform 1 from private.pre_cutover_release_lock where singleton for share;
      perform 1 from private.family_billing_config where singleton for share;
      perform 1 from private.family_media_quota_policy where singleton for share;
      if (select enabled from private.family_billing_config where singleton) is distinct from false
        or (select enabled from private.pre_cutover_release_lock where singleton) is distinct from true
        or (select storage_enforcement_enabled from private.family_media_quota_policy where singleton) is distinct from false
        or exists(select 1 from private.family_billing_test_accounts where enabled and expires_at>clock_timestamp()) then
        raise exception 'SANDBOX_CLOSED_BASELINE_REQUIRED'; end if;
    end; $closed$;`;
  const history = `
    insert into supabase_migrations.schema_migrations(version,name,statements)
      values('${yearlyVersion}','${yearlyName}',array[${quote(original)}]::text[]);
    do $acl$ declare fn oid; begin
      fn:=to_regprocedure('private.abandon_family_billing_yearly_intent(uuid,uuid,uuid,text,uuid,text,jsonb)');
      if fn is null or has_function_privilege('anon',fn,'EXECUTE')
        or has_function_privilege('authenticated',fn,'EXECUTE') or has_function_privilege('service_role',fn,'EXECUTE') then
        raise exception 'SANDBOX_YEARLY_ACL_DENIED'; end if;
    end; $acl$;`;
  return (
    original.slice(0, begin + '\nbegin;\n'.length) +
    guard +
    original.slice(begin + '\nbegin;\n'.length, commit) +
    history +
    original.slice(commit)
  );
}
