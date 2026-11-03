import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  withIsolatedMedia,
  read,
  quote,
} from './lib/isolated-family-media.mjs';

const free = 300 * 1024 ** 2;
const plus = 5 * 1024 ** 3;
const migration =
  'supabase/migrations/20261023055340_family_media_capacity_enforcement.sql';
await withIsolatedMedia(
  async ({ query, auth, id, baseUrl, token, docker, storageName, prefix }) => {
    query(
      read(
        'supabase/migrations/20261023044929_family_billing_auth_identity.sql',
      ),
    );
    query(
      read(
        'supabase/migrations/20261023045414_family_billing_release_contract.sql',
      ),
    );
    query('insert into private.family_billing_config(singleton) values(true);');
    const policies = query(
      "select md5(string_agg(to_jsonb(p)::text,',' order by policyname)) from pg_policies p where schemaname='storage';",
    );
    query(read(migration));
    query(
      read(
        'supabase/migrations/20261023074855_family_media_transition_fifteen_days.sql',
      ),
    );
    query(
      read(
        'supabase/migrations/20261024114459_family_media_capacity_release_readiness.sql',
      ),
    );
    assert.equal(
      query(
        'select legacy_tus_residual_risk_accepted from private.family_media_quota_policy;',
      ),
      'f',
      'installing the forward never accepts temporary-storage cost risk',
    );
    assert.equal(
      query(
        "select md5(string_agg(to_jsonb(p)::text,',' order by policyname)) from pg_policies p where schemaname='storage';",
      ),
      policies,
    );
    assert.equal(
      query('select enabled from private.family_billing_config;'),
      'f',
    );
    assert.equal(
      query(
        'select storage_enforcement_enabled from private.family_media_quota_policy;',
      ),
      'f',
    );
    const root = (actor = 'owner', pet = 'pet') => `${id(actor)}/${id(pet)}`;
    const path = (label, actor = 'owner', pet = 'pet', ext = 'jpg') =>
      `${root(actor, pet)}/${id('post-' + label)}/${id(label)}.${ext}`;
    const headers = (actor = 'owner') => ({
      authorization: `Bearer ${token(actor)}`,
      'x-homeypaw-platform': 'ios',
      'x-homeypaw-app-version': '1.3.0',
      'x-homeypaw-build': '10',
    });
    const upload = (
      label,
      {
        actor = 'owner',
        pet = 'pet',
        bytes = 4,
        upsert = false,
        bucket = 'post-media',
        ext = 'jpg',
      } = {},
    ) =>
      fetch(`${baseUrl}/object/${bucket}/${path(label, actor, pet, ext)}`, {
        method: 'POST',
        headers: {
          ...headers(actor),
          'content-type': ext === 'mp4' ? 'video/mp4' : 'image/jpeg',
          'x-upsert': String(upsert),
          'x-metadata': Buffer.from(
            JSON.stringify({ size: 0, isPlus: true }),
          ).toString('base64'),
        },
        body: new Uint8Array(bytes),
      });
    const okay = async (r) => {
      if (!r.ok) {
        const log = docker(['logs', storageName]);
        console.log('Storage failure codes:', [
          ...new Set(
            log.match(
              /(?:FAMILY_[A-Z_]+|QUOTA_[A-Z_]+|PRE_CUTOVER_[A-Z_]+|UPLOAD_[A-Z_]+)/g,
            ) ?? [],
          ),
        ]);
      }
      assert.ok(r.ok, `HTTP ${r.status}: ${await r.clone().text()}`);
      return r;
    };
    const used = () =>
      Number(
        query(
          `select used_bytes from private.family_media_usage where family_id=${quote(id('family'))};`,
        ) || 0,
      );
    const backendFiles = (label) =>
      Number(
        docker([
          'exec',
          storageName,
          'node',
          '-e',
          `const fs=require('fs');const root='/var/lib/storage';console.log(fs.readdirSync(root,{recursive:true}).filter(p=>p.includes(${JSON.stringify(id(label))})&&fs.statSync(root+'/'+p).isFile()).length);`,
        ]),
      );
    const summary = () =>
      JSON.parse(
        auth(
          'owner',
          `select public.get_family_plus_summary(${quote(id('family'))});`,
        )
          .split('\n')
          .find((x) => x.startsWith('{')),
      );
    // Disposable fixture teardown only. Actual deletion/refund is tested through
    // Storage HTTP below; this flag is never used on persistent or cloud data.
    const reset = () =>
      query(`set storage.allow_delete_query='true'; update private.family_media_quota_policy set storage_enforcement_enabled=false;
    delete from storage.objects; delete from private.family_media_objects; delete from private.family_media_measurement_errors;
    delete from private.family_media_upload_items;delete from private.family_media_upload_sessions;delete from private.family_media_usage;delete from private.family_media_entitlements;`);
    let seedSequence = 0;
    // Only baseline sizes are synthetic. New writes in every boundary assertion
    // below use the real Storage HTTP endpoint and its measured byte metadata.
    const seed = (total) => {
      const seq = ++seedSequence;
      query(`insert into storage.objects(id,bucket_id,name,owner_id,version,metadata)
      values(${quote(id('seed-' + seq))},'post-media',${quote(path('seed-' + seq))},${quote(id('owner'))},'fixture',jsonb_build_object('size',${total},'mimetype','image/jpeg'));
      select private.sync_family_media_objects(${quote(id('family'))});`);
    };
    const enable = () =>
      query(
        'update private.family_media_quota_policy set storage_enforcement_enabled=true,metering_started_at=clock_timestamp();',
      );
    assert.equal(summary().usage.status, 'uninitialized');
    await okay(await upload('off'));
    assert.equal(
      summary().usage.used_bytes,
      null,
      'unobserved OFF-mode objects never become fake zero',
    );
    assert.equal(summary().usage.status, 'uninitialized');
    reset();
    seed(free - 4);
    query(`create function private.capacity_activation_pause() returns trigger language plpgsql set search_path='' as $$begin
      if new.name=${quote(path('activation-race'))} and new.version<>'1' then perform pg_sleep(0.5);end if;return null;end;$$;
      create trigger z_capacity_activation_pause after insert on storage.objects for each row execute function private.capacity_activation_pause();`);
    const oldInFlight = upload('activation-race');
    let paused = false;
    for (let n = 0; n < 40; n++) {
      if (
        query(
          "select count(*) from pg_stat_activity where datname=current_database() and wait_event='PgSleep';",
        ) !== '0'
      ) {
        paused = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.ok(
      paused,
      'coordinate an actual OFF-era final upload with activation',
    );
    enable();
    await okay(await oldInFlight);
    assert.equal(summary().usage.status, 'pending');
    assert.ok(
      !(await upload('activation-overflow')).ok,
      'in-flight OFF upload cannot disappear from the activated budget',
    );
    query(`select private.sync_family_media_objects(${quote(id('family'))});`);
    assert.equal(used(), free);
    assert.equal(summary().usage.status, 'ready');
    reset();
    seed(free - 4);
    enable();
    assert.equal(
      summary().usage.status,
      'pending',
      'activation invalidates OFF-era coverage',
    );
    query(
      `select private.refresh_family_media_totals(${quote(id('family'))});`,
    );
    assert.equal(
      summary().usage.used_bytes,
      null,
      'a totals refresh cannot falsely certify complete coverage',
    );
    await okay(await upload('free-edge'));
    assert.equal(used(), free);
    assert.throws(
      () =>
        query(
          `set session authorization authenticator;begin;set local role authenticated;set local request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',${quote(id('owner'))},true);insert into storage.objects(bucket_id,name,owner_id,version,metadata) values('post-media',${quote(path('forged-sql'))},${quote(id('owner'))},'1','{"size":0}');rollback;`,
          undefined,
          'supabase_admin',
        ),
      /QUOTA_STORAGE_WRITER_REQUIRED/,
      'ordinary SQL role cannot forge final size or impersonate a Storage probe',
    );
    assert.equal(summary().usage.used_bytes, free);
    assert.equal(summary().usage.status, 'ready');
    const untouchedRows = query(
      "select json_agg(row(storage_object_id,xmin::text) order by storage_object_id) from private.family_media_objects where storage_version='fixture';",
    );
    let result = await upload('free-denied');
    assert.ok(!result.ok, 'legacy direct upload cannot exceed Free capacity');
    assert.equal(used(), free);
    assert.equal(
      query(
        `select count(*) from storage.objects where name=${quote(path('free-denied'))};`,
      ),
      '0',
    );
    assert.equal(
      backendFiles('free-denied'),
      0,
      'Storage removes rejected final object bytes, not just its database row',
    );
    result = await upload('free-edge');
    assert.ok(!result.ok, 'same-path retry cannot double insert');
    assert.equal(used(), free);
    result = await upload('free-edge', { bytes: 8, upsert: true });
    assert.ok(!result.ok, 'upsert increase cannot bypass cap');
    assert.equal(used(), free);
    assert.ok(
      !(await upload('free-edge', { bytes: 4, upsert: true })).ok,
      'existing Journal policy also denies same-size upsert; do not relax it',
    );
    assert.equal(
      used(),
      free,
      'rejected duplicate replacement is not counted twice',
    );
    await okay(
      await fetch(`${baseUrl}/object/post-media`, {
        method: 'DELETE',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [path('free-edge')] }),
      }),
    );
    assert.equal(
      used(),
      free - 4,
      'Storage API deletion returns actual bytes once',
    );
    await okay(await upload('after-delete'));
    assert.equal(used(), free);
    assert.equal(
      query(
        "select json_agg(row(storage_object_id,xmin::text) order by storage_object_id) from private.family_media_objects where storage_version='fixture';",
      ),
      untouchedRows,
      'ordinary uploads settle incrementally without rewriting historical objects',
    );
    for (const actor of ['viewer', 'removed', 'stranger'])
      assert.ok(!(await upload('denied-' + actor, { actor })).ok);
    assert.ok(!(await upload('cross-family', { pet: 'other-pet' })).ok);
    assert.throws(() =>
      auth(
        'owner',
        "insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference) values(public.rv2_id('family'),'plus',now(),now()+interval '1 day',false,'forged');",
      ),
    );
    reset();
    seed(free - 4);
    enable();
    const concurrent = await Promise.all([
      upload('race-owner'),
      upload('race-member', { actor: 'member' }),
    ]);
    assert.equal(concurrent.filter((r) => r.ok).length, 1);
    assert.equal(used(), free, 'cross-member writes serialize the last bytes');
    console.log(
      'PASS: actual legacy HTTP Free boundary, metadata spoofing, upsert/retry, API deletion, canonical roles, cross-Family denial and concurrent last-byte competition.',
    );
    reset();
    seed(plus - 4);
    query(
      `insert into private.family_media_entitlements(family_id,tier,starts_at,ends_at,ends_inclusive,source_reference) values(${quote(id('family'))},'plus',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',false,'isolated trusted grant');`,
    );
    enable();
    await okay(await upload('plus-edge'));
    assert.equal(used(), plus);
    assert.ok(!(await upload('plus-denied')).ok);
    assert.equal(summary().gives_plus_access, true);
    query(
      'update private.family_media_entitlements set revoked_at=clock_timestamp();',
    );
    assert.equal(summary().gives_plus_access, false);
    assert.equal(summary().usage.used_bytes, plus);
    assert.ok(
      !(await upload('downgraded')).ok,
      'downgrade retains history, rejects only new bytes',
    );
    await okay(
      await fetch(
        `${baseUrl}/object/authenticated/post-media/${path('plus-edge')}`,
        { headers: headers() },
      ),
    );
    console.log(
      'PASS: trusted Plus 5 GiB edge, revoked/downgraded history preserved and downloadable; no client-supplied Plus accepted.',
    );
    reset();
    seed(free - 24);
    enable();
    const media = new Uint8Array(24);
    const start = async (label, actor = 'owner', length = media.length) => {
      const meta = {
        bucketName: 'post-videos',
        objectName: path(label, actor, 'pet', 'mp4'),
        contentType: 'video/mp4',
      };
      const r = await fetch(baseUrl + '/upload/resumable', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token(actor)}`,
          'tus-resumable': '1.0.0',
          'upload-length': String(length),
          'upload-metadata': Object.entries(meta)
            .map(([k, v]) => k + ' ' + Buffer.from(v).toString('base64'))
            .join(','),
        },
      });
      assert.equal(r.status, 201, await r.clone().text());
      const url = new URL(r.headers.get('location'), baseUrl);
      return {
        url: baseUrl + url.pathname.replace(/^\/storage\/v1(?=\/)/u, ''),
        label,
        actor,
      };
    };
    const patch = (u, offset, body) =>
      fetch(u.url, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token(u.actor)}`,
          'tus-resumable': '1.0.0',
          'upload-offset': String(offset),
          'content-type': 'application/offset+octet-stream',
        },
        body,
      });
    const oversizedMetadata = {
      bucketName: 'post-videos',
      objectName: path('oversized-tus', 'owner', 'pet', 'mp4'),
      contentType: 'video/mp4',
    };
    const oversized = await fetch(baseUrl + '/upload/resumable', {
      method: 'POST',
      headers: {
        ...headers(),
        'tus-resumable': '1.0.0',
        'upload-length': String(25 * 1024 ** 2 + 1),
        'upload-metadata': Object.entries(oversizedMetadata)
          .map(
            ([key, value]) => key + ' ' + Buffer.from(value).toString('base64'),
          )
          .join(','),
      },
    });
    assert.equal(
      oversized.status,
      413,
      'platform global limit rejects an oversized TUS before parts are accepted',
    );
    assert.equal(oversized.headers.get('location'), null);
    const late = await start('tus-late');
    assert.equal((await patch(late, 0, media.subarray(0, 2))).status, 204);
    // Spend part of the headroom after TUS authorization, without quota sessions.
    await okay(await upload('during-tus'));
    result = await patch(late, 2, media.subarray(2));
    assert.ok(
      !result.ok,
      'previous TUS authorization cannot bypass final-byte quota',
    );
    assert.equal(
      query(
        `select count(*) from storage.objects where name=${quote(path('tus-late', 'owner', 'pet', 'mp4'))};`,
      ),
      '0',
    );
    assert.equal(used(), free - 20);
    result = await fetch(late.url, {
      method: 'DELETE',
      headers: { ...headers(), 'tus-resumable': '1.0.0' },
    });
    assert.ok(
      [204, 404, 410].includes(result.status),
      'failed TUS is terminated or already absent',
    );
    assert.ok(
      !(
        await fetch(late.url, {
          method: 'HEAD',
          headers: { ...headers(), 'tus-resumable': '1.0.0' },
        })
      ).ok,
    );
    reset();
    seed(free - 24);
    enable();
    const tus = await start('tus-good');
    assert.equal((await patch(tus, 0, media)).status, 204);
    assert.equal(used(), free);
    await patch(tus, media.length, new Uint8Array());
    assert.equal(
      used(),
      free,
      'replayed final TUS PATCH cannot double-count bytes',
    );
    const thumb = await upload('tus-good', { bucket: 'post-video-thumbnails' });
    assert.ok(!thumb.ok, 'thumbnail shares the same Family budget');
    const revokedTus = await start('revoked-tus', 'member');
    query(
      `update public.family_members set role='viewer' where user_id=${quote(id('member'))};`,
    );
    assert.ok(
      !(await patch(revokedTus, 0, media)).ok,
      'previous TUS permission cannot survive loss of Member upload role',
    );
    assert.equal(
      query(
        `select count(*) from storage.objects where name=${quote(path('revoked-tus', 'member', 'pet', 'mp4'))};`,
      ),
      '0',
    );
    query(
      `update public.family_members set role='member' where user_id=${quote(id('member'))};`,
    );
    console.log(
      'PASS: real TUS finalization enforces actual bytes after earlier authorization; valid TUS counts once and thumbnails cannot bypass capacity.',
    );
    reset();
    seed(free - 8 * 1024 ** 2);
    enable();
    const reserveLabel = 'reserved-photo',
      sid = id('capacity-session');
    const reserveSql = `select public.reserve_family_media_upload(${quote(sid)},${quote(id('pet'))},${quote(id('post-' + reserveLabel))},array[${quote(id(reserveLabel))}::uuid],null);`;
    auth('owner', reserveSql);
    auth('owner', reserveSql);
    assert.equal(
      query('select count(*) from private.family_media_upload_sessions;'),
      '1',
    );
    assert.ok(
      !(await upload('legacy-vs-reserved')).ok,
      'legacy must respect quota-aware reserved bytes',
    );
    auth('owner', `select public.cancel_family_media_upload(${quote(sid)});`);
    assert.equal(
      query(
        `select reserved_bytes from private.family_media_usage where family_id=${quote(id('family'))};`,
      ),
      '0',
    );
    assert.ok(
      !(await upload(reserveLabel)).ok,
      'cancelled quota session cannot finalize late',
    );
    await okay(await upload('after-cancel'));
    const expiredLabel = 'expired-photo',
      expiredId = id('expired-session');
    // Make room only in synthetic fixtures. No published content is removed.
    query(`update private.family_media_quota_policy set storage_enforcement_enabled=false;
      delete from private.family_media_upload_items;delete from private.family_media_upload_sessions;
      delete from private.family_media_usage;select private.sync_family_media_objects(${quote(id('family'))});`);
    // This session reserves the remaining headroom after reducing the seed.
    query(`update storage.objects set metadata=jsonb_set(metadata,'{size}',to_jsonb(${free - 16 * 1024 ** 2}::bigint)) where version='fixture';
      select private.sync_family_media_objects(${quote(id('family'))});`);
    enable();
    auth(
      'owner',
      `select public.reserve_family_media_upload(${quote(expiredId)},${quote(id('pet'))},${quote(id('post-' + expiredLabel))},array[${quote(id(expiredLabel))}::uuid],null);`,
    );
    query(
      `update private.family_media_upload_sessions set expires_at=clock_timestamp()-interval '1 minute' where id=${quote(expiredId)};`,
    );
    assert.ok(
      !(await upload(expiredLabel)).ok,
      'expired reservation cannot finalize late',
    );
    await okay(await upload('after-expiry'));
    assert.equal(
      query(
        `select coalesce(sum(reserved_bytes),0) from private.family_media_upload_sessions;`,
      ),
      '0',
    );
    assert.equal(
      query('select enabled from private.family_billing_config;'),
      'f',
    );
    query(
      'update private.family_media_quota_policy set storage_enforcement_enabled=false;',
    );
    console.log(
      'PASS: existing reservation idempotency, legacy/reservation competition, cancellation refund and late-write revocation; Billing OFF and persistent enforcement unchanged.',
    );
    // Do not confuse a final-object quota PASS with a strict physical cap on
    // abandoned TUS parts. The old protocol supplies no durable Family reserve.
    reset();
    seed(free - 4);
    enable();
    const fileBytes = () =>
      Number(
        docker([
          'exec',
          storageName,
          'node',
          '-e',
          "const fs=require('fs'),root='/var/lib/storage';console.log(fs.readdirSync(root,{recursive:true}).reduce((n,p)=>{const s=fs.statSync(root+'/'+p);return n+(s.isFile()?s.size:0)},0));",
        ]),
      );
    const beforeParts = fileBytes();
    const parts = await Promise.all([
      start('abandoned-1', 'owner', 8 * 1024 ** 2),
      start('abandoned-2', 'owner', 8 * 1024 ** 2),
    ]);
    for (const part of parts) {
      assert.equal(
        (await patch(part, 0, new Uint8Array(6 * 1024 ** 2))).status,
        204,
      );
      const head = await fetch(part.url, {
        method: 'HEAD',
        headers: { ...headers(), 'tus-resumable': '1.0.0' },
      });
      assert.equal(head.headers.get('upload-offset'), String(6 * 1024 ** 2));
    }
    assert.equal(
      used(),
      free - 4,
      'unfinished parts are outside final-object registry',
    );
    const partGrowth = fileBytes() - beforeParts;
    assert.ok(
      partGrowth >= 12 * 1024 ** 2,
      'accepted old-protocol partial bytes exceed available Family budget',
    );
    for (const part of parts) {
      assert.equal(
        (
          await fetch(part.url, {
            method: 'DELETE',
            headers: { ...headers(), 'tus-resumable': '1.0.0' },
          })
        ).status,
        204,
      );
      assert.ok(
        !(
          await fetch(part.url, {
            method: 'HEAD',
            headers: { ...headers(), 'tus-resumable': '1.0.0' },
          })
        ).ok,
      );
    }
    console.log(
      'RESIDUAL COST RISK: 4 Family bytes available but two old-protocol TUS sessions persist >=12 MiB of unfinished parts. Global 25 MiB per-upload rejection and explicit termination work; no aggregate Family temporary-byte bound is claimed.',
    );
    reset();
    query(
      'update private.family_media_quota_policy set metering_started_at=null,video_calendar_time_zone=null,video_counting_scope=null;',
    );
    query(read('scripts/sql/family-storage-quota-prototype.sql'));
    assert.ok(
      query(read('scripts/sql/family-plus-read-summary.sql')).endsWith(
        'FAMILY_PLUS_READ_SQL_PASS',
      ),
    );
    // Fault injection includes ALTER on Storage-owned objects: use only the
    // disposable database's administrator, then roll back every readiness flag.
    query(
      `${prefix}
      begin;update private.family_billing_config set enabled=true,environment='PRODUCTION',release_ready=true,rc_project_id='isolated',rc_app_id='isolated',rc_entitlement_id='family_plus',monthly_product_id='test.monthly',yearly_product_id='test.yearly';
      update private.family_media_quota_policy set storage_enforcement_enabled=false;
      select public.rv2_assert(not private.family_billing_can_charge(),'default OFF prevents charging');
      update private.family_media_quota_policy set storage_enforcement_enabled=true,metering_started_at=clock_timestamp();
      select public.rv2_assert(not private.family_billing_can_charge(),'no implicit acceptance of legacy temporary-storage cost');
      update private.family_media_quota_policy set legacy_tus_residual_risk_accepted=true;
      select public.rv2_assert(private.family_billing_can_charge(),'reviewed saved-media launch may explicitly accept residual temporary-storage cost');
      select public.rv2_assert((select not legacy_tus_admission_verified from private.family_media_quota_policy),'risk acknowledgement never fakes strict admission verification');
      update private.family_billing_config set release_ready=false;
      select public.rv2_assert(not private.family_billing_can_charge(),'risk acceptance cannot bypass release approval');
      update private.family_billing_config set release_ready=true;
      update private.family_media_quota_policy set storage_enforcement_enabled=false;
      select public.rv2_assert(not private.family_billing_can_charge(),'risk acceptance cannot bypass actual final capacity enforcement');
      update private.family_media_quota_policy set storage_enforcement_enabled=true;
      alter table storage.objects disable trigger family_media_capacity_commit;
      select public.rv2_assert(not private.family_billing_can_charge(),'risk acceptance cannot bypass missing final capacity trigger');
      alter table storage.objects enable trigger family_media_capacity_commit;
      select public.rv2_assert(private.family_billing_can_charge(),'all final capacity gates remain necessary');
      update private.family_media_quota_policy set legacy_tus_residual_risk_accepted=false,legacy_tus_admission_verified=true;
      select public.rv2_assert(private.family_billing_can_charge(),'future verified admission remains a separate supported path');
      select public.rv2_assert((select video_limit is null from private.family_media_limits(public.rv2_id('family'),now())),'no monthly video limit is part of release readiness');rollback;`,
      undefined,
      'supabase_admin',
    );
    assert.throws(
      () =>
        auth(
          'owner',
          'update private.family_media_quota_policy set legacy_tus_residual_risk_accepted=true;',
        ),
      /permission denied/,
      'an app Owner cannot acknowledge operational cost risk',
    );
    assert.equal(
      query(
        'select legacy_tus_residual_risk_accepted from private.family_media_quota_policy;',
      ),
      'f',
    );
    assert.equal(
      query('select enabled from private.family_billing_config;'),
      'f',
    );
    assert.equal(
      query(
        'select storage_enforcement_enabled from private.family_media_quota_policy;',
      ),
      'f',
    );
    console.log(
      'PASS: quota/cleanup/summary remain enforced; explicit private-only residual-risk approval cannot bypass release approval or final capacity enforcement; all activation and approval flags stay OFF.',
    );
  },
  {
    storage: true,
    storageFileSizeLimitBytes: 25 * 1024 ** 2,
    migration:
      'supabase/migrations/20261014104554_family_storage_quota_prototype.sql',
  },
);
