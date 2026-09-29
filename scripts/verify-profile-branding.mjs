import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

// Fixed local container only. No URL, linked-project, token or env override.
const container = 'supabase_db_pawday';
const historical = '20260822150000_create_profiles.sql';
const forward = '20260929105408_profile_default_branding.sql';
const releaseFiles = [
  '20260928072854_family_chat_remote_push_v1.sql',
  '20260928102325_reminder_recurrence_v2.sql',
  '20260929070417_journal_post_read_receipts_v1.sql',
];
const releaseHashes = [
  '03295e24aefc4f108db6a77df970556a099ea03ee771d2aee9f0d5d3da58ad5c',
  '4f57dabc104820dfe04624ebee5b22217046633e283f484fe3beee151dc19ebe',
  '824da4296a4ebbb4788ba2c6bd4ddba52f4c594a511d215da79c9a7f377eabd7',
];
const directory = new URL('../supabase/migrations/', import.meta.url);
const read = (name) => readFileSync(new URL(name, directory), 'utf8');
const hash = (value, algorithm = 'sha256') =>
  createHash(algorithm).update(value).digest('hex');

// Preserve dollar bodies and quoted literals while matching the exact recorded
// statements of this historical file, including whitespace and comments.
const statements = (source) => {
  const tokens =
    /\$\$[\s\S]*?\$\$|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|;/g;
  const result = [];
  let start = 0;
  for (const token of source.matchAll(tokens)) {
    if (token[0] !== ';') continue;
    result.push(source.slice(start, token.index).trim());
    start = token.index + 1;
  }
  if (source.slice(start).trim()) result.push(source.slice(start).trim());
  return result;
};
const oldSql = read(historical);
assert.equal(statements(oldSql).length, 15);
assert.equal(
  hash(statements(oldSql).join(''), 'md5'),
  '61a5f6f9afd5341d047b40fd318cb390',
  'Historical executable SQL must match the read-only Production history.',
);
const originalFunction = oldSql.match(
  /create or replace function public\.handle_new_user\(\)[\s\S]*?\$\$;/,
)?.[0];
assert.ok(originalFunction);
const newSql = read(forward);
assert.deepEqual(statements(newSql), [
  'begin',
  `${newSql.match(/-- Preserve[\s\S]*?(?=create or replace)/)?.[0] ?? ''}${originalFunction.replace("'Pawday user'", "'HomeyPaw user'")}`
    .trim()
    .slice(0, -1),
  'commit',
]);
releaseFiles.forEach((name, index) => {
  assert.equal(hash(read(name)), releaseHashes[index], `${name} is immutable.`);
  assert.ok(name < forward, 'Branding follows the three release migrations.');
});
console.log(
  'PASS: historical SQL matches Production; forward changes only the future default; three release migrations are byte-identical.',
);

const databases = [
  `homeypaw_branding_fresh_${process.pid}`,
  `homeypaw_branding_existing_${process.pid}`,
];
const sql = (input, database = 'postgres', user = 'postgres') =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      user,
      '-d',
      database,
      '-X',
      '-q',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: `set client_min_messages=warning;\n${input}`,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  ).trim();
const trusted = `set homeypaw.pre_cutover_migration_bypass='on';
set request.jwt.claim.role='service_role';
set request.headers='{"x-homeypaw-platform":"ios","x-homeypaw-app-version":"1.2.0","x-homeypaw-build":"9"}';`;
const tables = JSON.parse(
  sql(`select json_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname in ('public','private','supabase_migrations') or (n.nspname='auth' and c.relname='users'));`),
);
assert.ok(
  tables.every((name) => /^[a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*$/.test(name)),
);
const fingerprintSql = `select json_build_array(${tables.map((name) => `(select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),'')) from ${name} t)`).join(',')},
  (select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')));`;
const before = sql(fingerprintSql);
const functionState = `select json_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig)
  from pg_proc p where p.oid='public.handle_new_user()'::regprocedure;`;
const securityState = `select json_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,
  'trigger',(select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid='auth.users'::regclass and t.tgname='on_auth_user_created'))
  from pg_proc p where p.oid='public.handle_new_user()'::regprocedure;`;
const profileFingerprint = `select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by id),'')) from public.profiles p;`;
const created = [];
const states = [];
try {
  const schema = execFileSync(
    'docker',
    [
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--schema-only',
    ],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
  );
  const migrations = readdirSync(directory)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
  assert.equal(
    migrations.at(-1),
    forward,
    'Update this verifier if another migration is added.',
  );
  for (const [index, database] of databases.entries()) {
    execFileSync('docker', [
      'exec',
      container,
      'createdb',
      '-U',
      'postgres',
      '-T',
      'template0',
      database,
    ]);
    created.push(database);
    sql(schema, database, 'supabase_admin');
    if (index === 0) {
      // Only the scratch database is reset. Preserve real Supabase managed
      // schemas/roles, then replay every application migration in order.
      sql(
        'drop schema public cascade; drop schema private cascade; create schema public; grant usage on schema public to anon,authenticated,service_role;',
        database,
      );
      for (const name of migrations.filter((name) => name !== forward)) {
        sql(`${trusted}\n${read(name)}`, database);
      }
      assert.ok(
        JSON.parse(sql(functionState, database)).definition.includes(
          "'Pawday user'",
        ),
      );
    }
    const oldUser = randomUUID();
    const oldMetadata =
      index === 0 ? '{}' : '{"display_name":"Pawday user","locale":"en"}';
    sql(
      `${trusted} insert into auth.users(id,raw_user_meta_data) values ('${oldUser}','${oldMetadata}');`,
      database,
    );
    assert.equal(
      sql(
        `select display_name from public.profiles where id='${oldUser}';`,
        database,
      ),
      'Pawday user',
    );
    const profilesBefore = sql(profileFingerprint, database);
    const securityBefore = sql(securityState, database);
    sql(newSql, database);
    assert.equal(
      sql(profileFingerprint, database),
      profilesBefore,
      'Existing profile rows are untouched.',
    );
    assert.equal(
      sql(securityState, database),
      securityBefore,
      'Owner, ACL, definer, search_path and Auth trigger are preserved.',
    );
    const anonymous = randomUUID(),
      custom = randomUUID(),
      email = randomUUID();
    sql(
      `${trusted} insert into auth.users(id,email,raw_user_meta_data) values
      ('${anonymous}',null,'{}'),
      ('${custom}',null,'{"display_name":"Custom name","locale":"en"}'),
      ('${email}','synthetic@example.invalid','{}');`,
      database,
    );
    assert.equal(
      sql(
        `select display_name from public.profiles where id='${anonymous}';`,
        database,
      ),
      'HomeyPaw user',
    );
    assert.equal(
      sql(
        `select display_name from public.profiles where id='${custom}';`,
        database,
      ),
      'Custom name',
    );
    assert.equal(
      sql(
        `select display_name from public.profiles where id='${email}';`,
        database,
      ),
      'synthetic',
    );
    assert.equal(
      sql(
        `select display_name from public.profiles where id='${oldUser}';`,
        database,
      ),
      'Pawday user',
    );
    states.push(sql(functionState, database));
    console.log(
      `PASS: ${index === 0 ? `fresh ${migrations.length}-migration replay` : 'existing-local schema clone + forward only'}; future default, custom/email fallback, row preservation and security metadata.`,
    );
  }
  assert.equal(
    states[0],
    states[1],
    'Fresh and upgraded databases reach identical function definition/security state.',
  );
} finally {
  for (const database of created) {
    execFileSync('docker', [
      'exec',
      container,
      'dropdb',
      '-U',
      'postgres',
      '--force',
      database,
    ]);
  }
  assert.equal(
    sql(fingerprintSql),
    before,
    'Persistent development data/functions/history/outbox/config remain unchanged.',
  );
}
console.log(
  'PASS: fresh/upgrade function state matches; scratch DBs removed; persistent local fingerprint unchanged; no remote connection or worker invocation.',
);
