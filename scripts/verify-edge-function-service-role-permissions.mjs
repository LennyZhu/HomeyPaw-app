import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const localUrl = process.env.SUPABASE_LOCAL_URL?.trim();
if (
  !localUrl ||
  !['127.0.0.1', 'localhost'].includes(new URL(localUrl).hostname)
) {
  throw new Error('SAFETY STOP: Edge Function ACL verification is local only.');
}

const permissionMigrations = [
  'supabase/migrations/20260912090000_edge_function_service_role_permissions.sql',
  'supabase/migrations/20260914120000_journal_video_backend_foundation.sql',
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

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
  media_cleanup_jobs: ['INSERT', 'SELECT', 'UPDATE'],
  pet_invites: ['SELECT'],
  pet_members: ['SELECT'],
  pets: ['DELETE', 'SELECT'],
  post_media: ['SELECT'],
  post_videos: ['SELECT'],
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
  media_cleanup_jobs: [],
  pet_invites: [],
  pet_members: ['SELECT'],
  pets: ['DELETE', 'SELECT'],
  post_media: ['SELECT'],
  post_videos: ['SELECT'],
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
  !/\bgrant\s+all\b/iu.test(permissionMigrations),
  'Permission migrations grant ALL privileges.',
);
expect(
  !/\bgrant\s+(?:insert|update|delete|truncate|references|trigger)\b[^;]*\bto\s+(?:anon|authenticated|public)\b/iu.test(
    permissionMigrations,
  ),
  'Permission migrations grant a client role a write privilege.',
);
console.log(
  'PASS: service_role has the exact lifecycle and cleanup privilege matrix.',
);
console.log(
  'PASS: anon/authenticated table privileges are unchanged and no broad grant exists.',
);
