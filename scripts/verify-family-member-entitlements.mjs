// Offline PostgreSQL dependency fixture. Never reads env, linked refs or user data.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.003';
const container = `homeypaw-member-cap-${randomUUID().slice(0, 8)}`;
const executable =
  process.platform === 'darwin'
    ? '/Applications/Docker.app/Contents/Resources/bin/docker'
    : 'docker';
// Only local Unix Docker sockets; DOCKER_HOST and remote contexts are ignored.
const host =
  process.platform === 'darwin'
    ? `unix://${join(homedir(), '.docker/run/docker.sock')}`
    : 'unix:///var/run/docker.sock';
const docker = (args, input) =>
  execFileSync(executable, ['--host', host, ...args], {
    input,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
const psql = [
  'exec',
  '-i',
  container,
  'psql',
  '-h',
  '/tmp',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-X',
  '-qAt',
  '-v',
  'ON_ERROR_STOP=1',
];
const query = (sql) => docker(psql, sql).trim();
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const id = (s) => {
  const h = createHash('md5').update(`synthetic-capacity:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
};
const actorSQL = (name, sql) =>
  `begin; set local role authenticated; set local request.jwt.claim.sub=${q(id(name))}; ${sql} commit;`;
const auth = (name, sql) => query(actorSQL(name, sql));
const reject = (fn, pattern) =>
  assert.throws(fn, (e) => pattern.test(String(e.stderr || e.message)));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const functionText = (path, name, next) => {
  const source = read(path),
    start = source.indexOf(`create or replace function ${name}`);
  assert.ok(start >= 0);
  const end = next
    ? source.indexOf(`create or replace function ${next}`, start)
    : source.indexOf('\n$$;', start) + 4;
  assert.ok(end > start);
  return source.slice(start, end);
};
const c2 =
  'supabase/migrations/20260920113000_multi_pet_family_phase_c2_membership_invite_canonicalization.sql';
const c4 =
  'supabase/migrations/20260923130000_multi_pet_family_phase_c4i_single_family_membership.sql';
const migration =
  'supabase/migrations/20261104135554_family_subscription_member_limits.sql';
const summary = (f, actor = `${f}-owner`) =>
  JSON.parse(
    auth(actor, `select public.get_family_member_capacity(${q(id(f))});`),
  );
const create = (f, actor = `${f}-owner`, legacy = false) =>
  JSON.parse(
    auth(
      actor,
      `select row_to_json(r) from public.${legacy ? 'create_pet_invite' : 'create_family_invite'}(${q(id(f))}) r;`,
    ),
  );
const accept = (code, user, legacy = false) =>
  auth(
    user,
    `select row_to_json(r) from public.${legacy ? 'join_pet_with_invite' : 'join_family_with_invite'}(${q(code)}) r;`,
  );
const membershipFingerprint = () =>
  query(
    `select md5(string_agg(to_jsonb(m)::text,',' order by family_id,user_id)) from public.family_members m;`,
  );
function seed(f, count, plan = null, status = 'active') {
  let sql = `insert into public.families(id) values(${q(id(f))}); insert into public.pets(id,family_id,name) values(${q(id(f))},${q(id(f))},'Synthetic pet');`;
  for (let i = 0; i < count; i++) {
    const user = `${f}-${i === 0 ? 'owner' : `member-${i}`}`;
    sql += `insert into auth.users values(${q(id(user))}); insert into public.family_members(family_id,user_id,role) values(${q(id(f))},${q(id(user))},${q(i === 0 ? 'owner' : i === 2 ? 'viewer' : 'member')});`;
  }
  sql += `insert into public.pet_members select ${q(id(f))},user_id,role,created_at from public.family_members where family_id=${q(id(f))};`;
  if (plan) {
    const until =
      plan === 'expired' ? "now()-interval '1 hour'" : "now()+interval '1 day'";
    sql += `insert into private.family_store_subscriptions values(${q(id(`${f}-sub`))},${q(id(f))},'PRODUCTION','APP_STORE',${q(`synthetic.${plan === 'yearly' ? 'yearly' : 'monthly'}`)},${q(status)},true,now()-interval '2 days',${until});
      insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,billing_subscription_id,billing_environment) values(${q(id(f))},'plus',now()-interval '2 days',${until},${q(id(`${f}-sub`))},'PRODUCTION');`;
  }
  query(sql);
}
function race(sql) {
  return new Promise((resolve) => {
    const child = spawn(executable, ['--host', host, ...psql], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    child.stdout.on('data', (s) => {
      output += s;
    });
    child.stderr.on('data', (s) => {
      error += s;
    });
    child.on('error', (e) => resolve({ status: -1, error: e.message }));
    child.on('close', (status) => resolve({ status, output, error }));
    child.stdin.end(sql);
  });
}
let started = false;
try {
  docker([
    'run',
    '--pull=never',
    '--detach',
    '--name',
    container,
    '--network',
    'none',
    '--tmpfs',
    '/tmp:rw,mode=1777',
    '--user',
    'postgres',
    '--entrypoint',
    '/bin/sh',
    image,
    '-c',
    'initdb -D /tmp/member-cap-db --auth=trust >/tmp/initdb.log 2>&1 && exec postgres -D /tmp/member-cap-db -c listen_addresses= -c unix_socket_directories=/tmp',
  ]);
  started = true;
  for (let attempt = 0; ; attempt++) {
    try {
      query('select 1;');
      break;
    } catch {
      if (attempt > 80)
        throw new Error('Disposable PostgreSQL failed to start.');
      await pause(100);
    }
  }
  assert.equal(
    JSON.parse(docker(['inspect', container]))[0].HostConfig.NetworkMode,
    'none',
  );
  query(read('scripts/sql/family-member-capacity-fixture.sql'));
  for (const [f, count, plan, status] of [
    ['free-one', 1],
    ['free-two', 2],
    ['historical', 5],
    ['historical-eleven', 11],
    ['plus-nine', 9, 'monthly'],
    ['plus-ten', 10, 'yearly'],
    ['expired', 9, 'expired'],
    ['cancelled', 9, 'yearly', 'cancelled'],
    ['grace', 9, 'monthly', 'in_grace_period'],
    ['refunded', 1, 'yearly', 'refunded'],
    ['manual-grant', 1],
    ['wrong-environment', 1, 'yearly'],
    ['legacy', 3],
    ['legacy-expired', 3],
    ['legacy-revoked', 3],
    ['race', 1],
    ['rollback', 2],
    ['leave', 2],
    ['new-expiry', 1],
    ['cross-family', 1],
    ['legacy-cap', 9],
    ['legacy-viewer', 10],
    ['replace-legacy', 1],
    ['create-race', 1],
    ['cached-free-one', 1],
    ['cached-free-two', 2],
  ])
    seed(f, count, plan, status);
  query(
    Array.from(
      { length: 30 },
      (_, i) => `insert into auth.users values(${q(id(`candidate-${i}`))});`,
    ).join('\n'),
  );
  // Seed the original 10-person triggers and canonical/legacy 1.4.0 APIs.
  const cap = read(
    'supabase/migrations/20260909130000_family_member_global_cap.sql',
  ).split('create or replace function public.join_pet_with_invite')[0];
  query(cap);
  const a = read(
    'supabase/migrations/20260919091047_multi_pet_family_phase_a_foundation.sql',
  );
  query(
    a.slice(
      a.indexOf(
        'create or replace function private.enforce_family_member_limit',
      ),
      a.indexOf(
        'create or replace function private.validate_family_keeps_owner',
      ),
    ),
  );
  query(
    functionText(
      c2,
      'public.create_family_invite(',
      'public.preview_family_invite(',
    ),
  );
  query(
    functionText(
      c2,
      'public.create_family_invite(',
      'public.revoke_family_invite(',
    ).replace(
      'public.create_family_invite(',
      'public.cached_old_create_family_invite(',
    ),
  );
  query(functionText(c4, 'public.join_family_with_invite('));
  query(
    functionText(c2, 'public.create_pet_invite(', 'public.preview_pet_invite('),
  );
  query(
    functionText(
      c2,
      'public.join_pet_with_invite(',
      'public.remove_pet_member(',
    ),
  );
  const legacy = create('legacy');
  const legacyExpired = create('legacy-expired');
  const legacyRevoked = create('legacy-revoked');
  const legacyCap = create('legacy-cap');
  const legacyViewer = create('legacy-viewer');
  const rolling = create('rollback');
  const replaceLegacy = create('replace-legacy');
  const cachedFullInvite = create('cached-free-two');
  // Backdate only the synthetic fixture before cutover, preserving both mirrors.
  query(`update public.family_invites set created_at=created_at-interval '1 minute';
    update public.pet_invites set created_at=created_at-interval '1 minute';
    update public.family_members set role='member' where family_id=${q(id('legacy-cap'))} and role='viewer';
    update public.pet_members set role='member' where pet_id=${q(id('legacy-cap'))} and role='viewer';
    insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at)
      values(${q(id('manual-grant'))},'plus',now()-interval '1 day',now()+interval '1 day');
    update private.family_store_subscriptions set environment='SANDBOX' where family_id=${q(id('wrong-environment'))};
    update private.family_media_entitlements set billing_environment='SANDBOX' where family_id=${q(id('wrong-environment'))};`);
  query(
    `update public.family_invites set used_count=2 where id=${q(legacy.invite_id)}; update public.pet_invites set used_count=2 where id=${q(legacy.invite_id)};`,
  );
  const before = membershipFingerprint();
  const invitesBefore = query(
    "select md5(string_agg(to_jsonb(i)::text,',' order by id)) from public.family_invites i;",
  );
  query(read(migration));
  assert.equal(
    membershipFingerprint(),
    before,
    'Migration must preserve every existing membership',
  );
  assert.equal(
    query(
      "select md5(string_agg(to_jsonb(i)::text,',' order by id)) from public.family_invites i;",
    ),
    invitesBefore,
  );
  assert.equal(summary('free-one').member_limit, 2);
  const cached = JSON.parse(
    auth(
      'cached-free-one-owner',
      `select row_to_json(r) from public.cached_old_create_family_invite(${q(id('cached-free-one'))}) r;`,
    ),
  );
  assert.equal(
    cached.invite_max_uses,
    1,
    'INSERT guard bounds an old in-flight five-use RPC',
  );
  const cachedBefore = query(
    `select to_jsonb(i)::text from public.family_invites i where id=${q(cachedFullInvite.invite_id)};`,
  );
  reject(
    () =>
      auth(
        'cached-free-two-owner',
        `select * from public.cached_old_create_family_invite(${q(id('cached-free-two'))});`,
      ),
    /family_member_limit_reached/,
  );
  assert.equal(
    query(
      `select to_jsonb(i)::text from public.family_invites i where id=${q(cachedFullInvite.invite_id)};`,
    ),
    cachedBefore,
  );
  assert.equal(
    summary('historical').member_count,
    5,
    'Viewers count toward the total',
  );
  assert.equal(summary('historical').can_create_invite, false);
  for (const f of [
    'free-two',
    'historical',
    'historical-eleven',
    'plus-ten',
    'expired',
  ])
    reject(() => create(f), /family_member_limit_reached/);
  for (const f of ['plus-nine', 'plus-ten', 'cancelled', 'grace'])
    assert.equal(summary(f).member_limit, 10);
  assert.equal(summary('expired').member_limit, 2);
  for (const f of ['manual-grant', 'wrong-environment', 'refunded'])
    assert.equal(summary(f).member_limit, 2);
  assert.equal(summary('historical-eleven').member_count, 11);
  const paid = create('plus-nine');
  assert.equal(paid.invite_max_uses, 1);
  accept(paid.invite_code, 'candidate-0');
  assert.equal(summary('plus-nine').member_count, 10);
  reject(() => accept(paid.invite_code, 'candidate-0'), /ALREADY_IN_FAMILY/);
  // Expiry keeps ten people but closes further growth immediately.
  query(
    `update private.family_store_subscriptions set access_until=now()-interval '1 second' where family_id=${q(id('plus-nine'))};`,
  );
  assert.equal(summary('plus-nine').member_limit, 2);
  assert.equal(summary('plus-nine').member_count, 10);
  reject(() => create('plus-nine'), /family_member_limit_reached/);
  query(
    `update public.family_members set role='member' where family_id=${q(id('historical'))} and role='viewer'; update public.pet_members set role='member' where pet_id=${q(id('historical'))} and role='viewer';`,
  );
  assert.equal(
    summary('historical').member_count,
    5,
    'Role updates do not evict or re-admit people',
  );
  query(
    `insert into public.pets(id,family_id,name) values(${q(id('historical-new-pet'))},${q(id('historical'))},'Another synthetic pet'); insert into public.pet_members select ${q(id('historical-new-pet'))},user_id,role,created_at from public.family_members where family_id=${q(id('historical'))};`,
  );
  const free = create('free-one', 'free-one-owner', true);
  assert.deepEqual(
    Object.keys(free).sort(),
    [
      'invite_code',
      'invite_created_at',
      'invite_expires_at',
      'invite_id',
      'invite_max_uses',
      'invite_used_count',
    ].sort(),
  );
  assert.equal(free.invite_max_uses, 1);
  assert.equal(
    query(
      `select count(*) from private.family_invite_legacy_allowances where invite_id=${q(free.invite_id)};`,
    ),
    '0',
  );
  assert.equal(summary('free-one').reserved_seats, 1);
  const joined = JSON.parse(accept(free.invite_code, 'candidate-1', true));
  assert.deepEqual(
    Object.keys(joined).sort(),
    ['join_status', 'joined_pet_id', 'joined_pet_name'].sort(),
  );
  assert.equal(summary('free-one').member_count, 2);
  assert.equal(summary('free-one').reserved_seats, 0);
  reject(() => accept(free.invite_code, 'candidate-2'), /invite_invalid/);
  reject(() => create('free-one', 'candidate-1'), /family not found/);
  reject(
    () =>
      auth(
        'cross-family-owner',
        `select public.get_family_member_capacity(${q(id('free-one'))});`,
      ),
    /family not found/,
  );
  reject(
    () =>
      query(
        `begin; set local role anon; select public.get_family_member_capacity(${q(id('free-one'))}); commit;`,
      ),
    /permission denied/,
  );
  reject(
    () =>
      auth(
        'free-one-owner',
        `select private.family_member_plan(${q(id('free-one'))},now());`,
      ),
    /permission denied/,
  );
  reject(
    () =>
      auth(
        'free-one-owner',
        `insert into private.family_invite_legacy_admissions values(${q(free.invite_id)},1,${q(id('free-one'))},${q(id('candidate-2'))},txid_current(),1,2,now());`,
      ),
    /permission denied/,
  );
  // Known client-set session flags cannot bypass grants or the canonical trigger.
  reject(
    () =>
      auth(
        'free-one-owner',
        `set local homeypaw.member_capacity_bypass='on'; insert into public.family_members values(${q(id('free-one'))},${q(id('candidate-2'))},'member',now());`,
      ),
    /permission denied/,
  );
  reject(
    () =>
      query(
        `insert into public.family_members values(${q(id('free-one'))},${q(id('candidate-2'))},'viewer',now());`,
      ),
    /family_member_limit_reached/,
  );
  assert.equal(summary('legacy').legacy_invite_remaining, 3);
  const legacyState = query(
    `select to_jsonb(i)::text from public.family_invites i where id=${q(legacy.invite_id)};`,
  );
  reject(() => create('legacy'), /family_member_limit_reached/);
  assert.equal(
    query(
      `select to_jsonb(i)::text from public.family_invites i where id=${q(legacy.invite_id)};`,
    ),
    legacyState,
    'Full-family creation must not revoke the old invitation',
  );
  for (let i = 3; i < 6; i++)
    accept(legacy.invite_code, `candidate-${i}`, i === 3);
  assert.equal(summary('legacy').member_count, 6);
  assert.equal(
    query(
      `select count(*) from private.family_invite_legacy_admissions where invite_id=${q(legacy.invite_id)};`,
    ),
    '3',
  );
  reject(() => accept(legacy.invite_code, 'candidate-6'), /invite_invalid/);
  reject(
    () =>
      query(
        `update private.family_invite_legacy_admissions set plan_limit=10;`,
      ),
    /append only/,
  );
  reject(
    () => query(`delete from private.family_invite_legacy_allowances;`),
    /append only/,
  );
  reject(() => create('legacy'), /family_member_limit_reached/);
  const replacement = create('replace-legacy');
  assert.equal(replacement.invite_max_uses, 1);
  assert.equal(summary('replace-legacy').legacy_invite_remaining, 0);
  assert.equal(
    query(
      `select count(*) from private.family_invite_legacy_allowances where invite_id=${q(replaceLegacy.invite_id)};`,
    ),
    '1',
  );
  reject(
    () => accept(replaceLegacy.invite_code, 'candidate-7'),
    /invite_invalid/,
  );
  query(
    `update public.family_invites set expires_at=now()-interval '1 second' where id=${q(legacyExpired.invite_id)}; update public.pet_invites set expires_at=now()-interval '1 second' where id=${q(legacyExpired.invite_id)};`,
  );
  reject(
    () => accept(legacyExpired.invite_code, 'candidate-6'),
    /invite_invalid/,
  );
  auth(
    'legacy-revoked-owner',
    `select public.revoke_family_invite(${q(id('legacy-revoked'))});`,
  );
  reject(
    () => accept(legacyRevoked.invite_code, 'candidate-6'),
    /invite_invalid/,
  );
  accept(legacyCap.invite_code, 'candidate-6');
  reject(
    () => accept(legacyCap.invite_code, 'candidate-7'),
    /family_member_limit_reached/,
  );
  assert.equal(summary('legacy-cap').member_count, 10);
  accept(legacyViewer.invite_code, 'candidate-10');
  assert.equal(
    summary('legacy-viewer').member_count,
    11,
    'Preserve original legacy eligibility with an existing Viewer',
  );
  reject(
    () => accept(legacyViewer.invite_code, 'candidate-11'),
    /family_member_limit_reached/,
  );
  reject(() => create('legacy-viewer'), /family_member_limit_reached/);
  assert.equal(
    query(
      `select count(*) from private.family_invite_legacy_admissions where invite_id=${q(legacyViewer.invite_id)};`,
    ),
    '1',
  );
  // A failing mirror update must roll back membership, audit and invite use together.
  query(`delete from public.pet_invites where id=${q(rolling.invite_id)};`);
  const rollbackCount = summary('rollback').member_count;
  reject(() => accept(rolling.invite_code, 'candidate-7'), /invite_invalid/);
  assert.equal(summary('rollback').member_count, rollbackCount);
  assert.equal(
    query(
      `select count(*) from private.family_invite_legacy_admissions where invite_id=${q(rolling.invite_id)};`,
    ),
    '0',
  );
  assert.equal(
    query(
      `select used_count from public.family_invites where id=${q(rolling.invite_id)};`,
    ),
    '0',
  );
  const expiring = create('new-expiry');
  auth(
    'new-expiry-owner',
    `select public.revoke_family_invite(${q(id('new-expiry'))});`,
  );
  assert.equal(summary('new-expiry').reserved_seats, 0);
  reject(() => accept(expiring.invite_code, 'candidate-7'), /invite_invalid/);
  query(
    `update public.family_invites set created_at=now()-interval '1 minute' where family_id=${q(id('new-expiry'))};`,
  );
  const expiring2 = create('new-expiry');
  assert.equal(summary('new-expiry').reserved_seats, 1);
  query(
    `update public.family_invites set expires_at=now()-interval '1 second' where id=${q(expiring2.invite_id)}; update public.pet_invites set expires_at=now()-interval '1 second' where id=${q(expiring2.invite_id)};`,
  );
  assert.equal(summary('new-expiry').reserved_seats, 0);
  // Existing lifecycle deletions release a place; no automatic member changes.
  query(
    `delete from public.pet_members where user_id=${q(id('leave-member-1'))}; delete from public.family_members where user_id=${q(id('leave-member-1'))};`,
  );
  assert.equal(summary('leave').can_create_invite, true);
  create('leave');
  // Two independent PostgreSQL sessions race for the last reserved Free place.
  const competing = create('race');
  const results = await Promise.all(
    ['candidate-8', 'candidate-9'].map((user) =>
      race(
        actorSQL(
          user,
          `select * from public.join_family_with_invite(${q(competing.invite_code)}); select pg_sleep(0.2);`,
        ),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === 0).length, 1);
  assert.match(
    results.find((r) => r.status !== 0).error,
    /invite_invalid|family_member_limit_reached/,
  );
  assert.equal(summary('race').member_count, 2);
  const creates = await Promise.all(
    [1, 2].map(() =>
      race(
        actorSQL(
          'create-race-owner',
          `select * from public.create_family_invite(${q(id('create-race'))}); select pg_sleep(0.2);`,
        ),
      ),
    ),
  );
  assert.equal(
    creates.filter((r) => r.status === 0).length,
    1,
    'Concurrent creation keeps one reservation pool',
  );
  assert.match(creates.find((r) => r.status !== 0).error, /rate limited/);
  assert.equal(summary('create-race').reserved_seats, 1);
  reject(
    () =>
      auth(
        'race-owner',
        `select public.create_family_invite(${q(id('race'))});`,
      ),
    /family_member_limit_reached/,
  );
  reject(
    () =>
      query(
        `begin isolation level repeatable read; select private.lock_family_member_capacity(${q(id('race'))}); commit;`,
      ),
    /fresh transaction/,
  );
  assert.equal(
    query('select enabled from private.family_billing_config;'),
    'f',
    'No Billing flag mutation',
  );
  console.log(
    'PASS: isolated PostgreSQL dependency fixture; Free 1/2/historical, Plus 9/10/expiry/cancelled, Owner+Viewer counts, immutable finite legacy invitations, rollback, reservation release, last-place race, unchanged 1.4.0 RPC columns and privileges. No hosted services or persistent database used.',
  );
} catch (e) {
  console.error(String(e.stderr || e.stack || e));
  process.exitCode = 1;
} finally {
  if (started) docker(['rm', '--force', container]);
}
