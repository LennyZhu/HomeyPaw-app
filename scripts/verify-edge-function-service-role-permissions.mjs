import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const localUrl = process.env.SUPABASE_LOCAL_URL?.trim();
if (
  !localUrl ||
  !['127.0.0.1', 'localhost'].includes(new URL(localUrl).hostname)
) {
  throw new Error('SAFETY STOP: Edge Function ACL verification is local only.');
}

const migration = readFileSync(
  'supabase/migrations/20260912090000_edge_function_service_role_permissions.sql',
  'utf8',
);

function sql(statement) {
  return execFileSync(
    'docker',
    [
      'exec',
      'supabase_db_pawday',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
      '-c',
      statement,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function hasTablePrivilege(role, table, privilege) {
  return (
    sql(
      `select has_table_privilege('${role}', 'public.${table}', '${privilege}');`,
    ) === 't'
  );
}

const serviceMatrix = {
  pet_invites: ['SELECT'],
  pet_members: ['SELECT'],
  pets: ['DELETE', 'SELECT'],
  post_media: ['SELECT'],
  posts: ['DELETE', 'SELECT'],
  profiles: ['SELECT'],
};

expect(
  sql("select has_schema_privilege('service_role', 'public', 'USAGE');") ===
    't',
  'service_role is missing its existing public schema usage.',
);

const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
];

for (const [table, allowed] of Object.entries(serviceMatrix)) {
  for (const privilege of tablePrivileges) {
    expect(
      hasTablePrivilege('service_role', table, privilege) ===
        allowed.includes(privilege),
      `Unexpected service_role ${privilege} privilege on public.${table}.`,
    );
  }
}

const authenticatedTablePrivileges = {
  pet_invites: [],
  pet_members: ['SELECT'],
  pets: ['DELETE', 'SELECT'],
  post_media: ['SELECT'],
  posts: ['SELECT'],
  profiles: ['SELECT'],
};

for (const role of ['anon', 'authenticated']) {
  for (const [table, authenticatedAllowed] of Object.entries(
    authenticatedTablePrivileges,
  )) {
    const allowed = role === 'authenticated' ? authenticatedAllowed : [];
    for (const privilege of tablePrivileges) {
      expect(
        hasTablePrivilege(role, table, privilege) ===
          allowed.includes(privilege),
        `Unexpected ${role} ${privilege} table privilege on public.${table}.`,
      );
    }
  }
}

expect(
  !/\bgrant\s+(?:all|insert|update|truncate|references|trigger)\b/iu.test(
    migration,
  ),
  'Permission migration grants an unnecessary table privilege.',
);
expect(
  !/\bto\s+(?:anon|authenticated|public)\b/iu.test(migration),
  'Permission migration widened a client role.',
);
console.log(
  'PASS: service_role has the exact lifecycle Edge Function SELECT/DELETE matrix.',
);
console.log(
  'PASS: anon/authenticated table privileges are unchanged and no broad grant exists.',
);
