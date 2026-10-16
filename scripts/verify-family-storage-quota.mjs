import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  read,
  quote,
  withIsolatedMedia,
} from './lib/isolated-family-media.mjs';

const migration =
  'supabase/migrations/20261014104554_family_storage_quota_prototype.sql';
await withIsolatedMedia(
  async ({ query, auth, id, database, dbContainer, prefix }) => {
    query(read('scripts/sql/family-storage-quota-prototype.sql'));
    console.log(
      'PASS: Free/Transition/Plus byte boundaries, policy readiness, server-only entitlement, monthly reservations, actual-size settlement, idempotency, cleanup, retained video count, canonical roles, Family isolation, late completion and Owner transfer.',
    );
    const run = promisify(execFile);
    const transaction = async (actor, sql) =>
      run(
        'docker',
        [
          'exec',
          '-i',
          dbContainer,
          'psql',
          '-U',
          'postgres',
          '-d',
          database,
          '-X',
          '-q',
          '-tA',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `${prefix} begin;set local role authenticated;set local request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',${quote(id(actor))},true);${sql} commit;`,
        ],
        { timeout: 15_000 },
      );
    const reserve = (actor, label, video) =>
      transaction(actor, `select public.fq_reserve(${quote(label)},${video});`);
    const race = await Promise.allSettled(
      [0, 1, 2, 3].map((i) =>
        reserve(i % 2 ? 'member' : 'owner', `race-video-${i}`, true),
      ),
    );
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 3);
    for (const r of race.filter((r) => r.status === 'rejected'))
      assert.match(r.reason.stderr, /FAMILY_VIDEO_QUOTA_EXCEEDED/u);
    assert.equal(
      Number(
        query(
          'select count(*) from private.family_media_upload_sessions where video_slot_held;',
        ),
      ),
      3,
    );
    assert.equal(
      Number(
        query(
          "select reserved_bytes from private.family_media_usage where family_id=public.rv2_id('family');",
        ),
      ),
      3 * 27 * 1024 * 1024,
    );
    console.log(
      'PASS: four real concurrent Owner/Member transactions atomically allocate exactly three video slots, never four.',
    );
    for (let i = 0; i < 4; i++)
      if (race[i].status === 'fulfilled') {
        auth(
          i % 2 ? 'member' : 'owner',
          `select public.cancel_family_media_upload(public.fq_id('race-video-${i}'));`,
        );
        query(
          `select public.release_closed_family_media_upload(public.fq_id('race-video-${i}'));`,
        );
      }
    query('select public.fq_fill_usage(306184192);'); // 300 MiB - one 8 MiB photo.
    const bytes = await Promise.allSettled([
      reserve('owner', 'race-photo-owner', false),
      reserve('member', 'race-photo-member', false),
    ]);
    assert.equal(bytes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(
      bytes.find((r) => r.status === 'rejected').reason.stderr,
      /FAMILY_STORAGE_QUOTA_EXCEEDED/u,
    );
    assert.equal(
      Number(
        query(
          "select used_bytes+reserved_bytes from private.family_media_usage where family_id=public.rv2_id('family');",
        ),
      ),
      300 * 1024 * 1024,
    );
    console.log(
      'PASS: concurrent photo reservations serialize at the exact 300 MiB Family boundary.',
    );
    auth(
      'stranger',
      `select public.reserve_family_media_upload(public.fq_id('finalize-race'),public.rv2_id('other-pet'),public.fq_id('finalize-post'),array[public.fq_id('finalize-asset')]);select public.fq_upload('finalize-race');`,
    );
    const finalized = await Promise.allSettled(
      [0, 1].map(() =>
        transaction(
          'stranger',
          "select public.settle_family_media_upload(public.fq_id('finalize-race'));",
        ),
      ),
    );
    assert.ok(finalized.every((r) => r.status === 'fulfilled'));
    assert.equal(
      Number(
        query(
          "select used_bytes from private.family_media_usage where family_id=public.rv2_id('other');",
        ),
      ),
      4,
    );
    assert.equal(
      Number(
        query(
          "select count(*) from private.family_media_objects where family_id=public.rv2_id('other');",
        ),
      ),
      1,
    );
    console.log(
      'PASS: two simultaneous finalize calls settle one object and four actual bytes exactly once.',
    );
  },
  { migration },
);
