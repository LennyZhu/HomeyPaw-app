import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { withIsolatedMedia, quote } from './lib/isolated-family-media.mjs';

await withIsolatedMedia(
  async ({ query, auth, id, baseUrl, token }) => {
    query(`create table private.transport_gate(enabled boolean not null);
    insert into private.transport_gate values(true);
    create table private.transport_probe(metadata jsonb);
    create function private.transport_permission(metadata jsonb) returns boolean
    language plpgsql volatile security definer set search_path='' as $$ begin
      insert into private.transport_probe values(metadata);
      return (select enabled from private.transport_gate);
    end; $$;
    revoke all on function private.transport_permission(jsonb) from public,anon;
    grant execute on function private.transport_permission(jsonb) to authenticated;
    create policy isolated_transport_gate on storage.objects as restrictive
      for insert to authenticated with check(bucket_id not in('post-media','post-videos','post-video-thumbnails') or private.transport_permission(metadata));`);
    const path = (actor, label, suffix = 'jpg') =>
      `${id(actor)}/${id('pet')}/${id(`post-${label}`)}/${id(label)}.${suffix}`;
    const headers = (actor) => ({ authorization: `Bearer ${token(actor)}` });
    const upload = (actor, name) =>
      fetch(`${baseUrl}/object/post-media/${name}`, {
        method: 'POST',
        headers: {
          ...headers(actor),
          'content-type': 'image/jpeg',
          'x-upsert': 'false',
        },
        body: new Uint8Array([255, 216, 255, 217]),
      });
    const count = () =>
      Number(query('select count(*) from private.transport_probe;'));
    let r = await upload('owner', path('owner', 'photo'));
    assert.ok(r.ok, `Legacy photo upload: ${r.status} ${await r.text()}`);
    assert.equal(
      count(),
      0,
      'Permission dry-run writes roll back; internal final insert does not persist RLS side effects.',
    );
    assert.equal(
      Number(
        query(
          `select (metadata->>'size')::bigint from storage.objects where name=${quote(path('owner', 'photo'))};`,
        ),
      ),
      4,
    );
    for (const actor of ['viewer', 'removed', 'stranger']) {
      r = await upload(actor, path(actor, `deny-${actor}`));
      assert.ok(!r.ok, `${actor} cannot upload.`);
    }
    console.log(
      'PASS: real standard Storage upload, canonical role denial, rollback of permission-side reservations and trusted final metadata.',
    );
    const media = Buffer.from([
      0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115,
      111, 109, 105, 115, 111, 50,
    ]);
    const start = async (actor, label) => {
      const name = path(actor, label, 'mp4');
      const metadata = {
        bucketName: 'post-videos',
        objectName: name,
        contentType: 'video/mp4',
      };
      const result = await fetch(`${baseUrl}/upload/resumable`, {
        method: 'POST',
        headers: {
          ...headers(actor),
          'tus-resumable': '1.0.0',
          'upload-length': String(media.length),
          'upload-metadata': Object.entries(metadata)
            .map(([k, v]) => `${k} ${Buffer.from(v).toString('base64')}`)
            .join(','),
        },
      });
      assert.equal(result.status, 201, `TUS create: ${await result.text()}`);
      const location = result.headers.get('location');
      assert.ok(location);
      const url = new URL(location, baseUrl);
      // Storage can advertise the original local gateway; use our isolated port.
      return {
        url: baseUrl + url.pathname.replace(/^\/storage\/v1(?=\/)/u, ''),
        name,
        actor,
      };
    };
    const patch = (s, offset, bytes, actor = s.actor) =>
      fetch(s.url, {
        method: 'PATCH',
        headers: {
          ...headers(actor),
          'tus-resumable': '1.0.0',
          'upload-offset': String(offset),
          'content-type': 'application/offset+octet-stream',
        },
        body: bytes,
      });
    const initial = count();
    const s = await start('member', 'legacy-video');
    assert.equal(
      count(),
      initial,
      'TUS POST is permission preflight, not a durable reservation.',
    );
    r = await patch(s, 0, media.subarray(0, 2));
    assert.equal(r.status, 204, await r.text());
    r = await fetch(s.url, {
      method: 'HEAD',
      headers: { ...headers('member'), 'tus-resumable': '1.0.0' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('upload-offset'), '2');
    r = await patch(s, 2, media.subarray(2));
    assert.equal(r.status, 204, await r.text());
    assert.equal(
      Number(
        query(
          `select (metadata->>'size')::bigint from storage.objects where bucket_id='post-videos' and name=${quote(s.name)};`,
        ),
      ),
      media.length,
    );
    // Publish through the unchanged legacy v2 RPC, without a quota session.
    const thumb = s.name.replace(/\.mp4$/u, '.jpg');
    r = await fetch(`${baseUrl}/object/post-video-thumbnails/${thumb}`, {
      method: 'POST',
      headers: { ...headers('member'), 'content-type': 'image/jpeg' },
      body: new Uint8Array([255, 216, 255, 217]),
    });
    assert.ok(r.ok, await r.text());
    const item = {
      id: id('legacy-video'),
      storage_path: s.name,
      thumbnail_path: thumb,
      duration_ms: 1000,
      width: 10,
      height: 10,
      mime_type: 'video/mp4',
    };
    auth(
      'member',
      `select public.create_post_v2(${quote(id('post-legacy-video'))}::uuid,${quote(id('pet'))}::uuid,null,'other',current_date,null,'[]'::jsonb,${quote(JSON.stringify(item))}::jsonb);`,
    );
    console.log(
      'PASS: real legacy TUS POST/PATCH/HEAD/resume and unchanged create_post_v2 publishing without a quota session.',
    );

    const gated = await start('owner', 'permission-revoked');
    r = await patch(gated, 0, media.subarray(0, 2));
    assert.equal(r.status, 204);
    query('update private.transport_gate set enabled=false;');
    r = await patch(gated, 2, media.subarray(2));
    assert.ok(
      !r.ok,
      'An already-issued TUS URL must not bypass changed INSERT policy.',
    );
    assert.equal(
      query(
        `select exists(select 1 from storage.objects where bucket_id='post-videos' and name=${quote(gated.name)});`,
      ),
      'f',
    );
    query('update private.transport_gate set enabled=true;');
    console.log(
      'PASS: TUS final completion rechecks changed RLS; authorization at POST does not permanently authorize completion.',
    );

    const removed = await start('member', 'membership-revoked');
    r = await patch(removed, 0, media.subarray(0, 2));
    assert.equal(r.status, 204);
    query(
      `delete from public.family_members where user_id=public.rv2_id('member');`,
    );
    r = await patch(removed, 2, media.subarray(2));
    assert.ok(!r.ok, 'Removed member cannot finish TUS using their old JWT.');
    const expired = await start('owner', 'expired-url');
    await new Promise((resolve) => setTimeout(resolve, 13_000));
    r = await patch(expired, 0, media);
    assert.equal(
      r.status,
      204,
      'This local file-backed Storage version still accepts completion after configured TUS expiry.',
    );
    assert.equal(
      query(
        `select exists(select 1 from storage.objects where name=${quote(expired.name)});`,
      ),
      't',
    );
    console.log(
      'BLOCKER EVIDENCE: configured TUS TTL 12s, waited 13s, late PATCH still 204 with a final object. A timer alone cannot prove capability closure.',
    );
    const terminated = await start('owner', 'terminated-url');
    r = await fetch(terminated.url, {
      method: 'DELETE',
      headers: { ...headers('owner'), 'tus-resumable': '1.0.0' },
    });
    assert.equal(r.status, 204, await r.text());
    r = await patch(terminated, 0, media);
    assert.ok(!r.ok, 'Explicitly terminated TUS cannot finish.');
    assert.equal(
      query(
        `select exists(select 1 from storage.objects where name=${quote(terminated.name)});`,
      ),
      'f',
    );
    console.log(
      'PASS: membership removal denies late completion; explicit TUS termination prevents later completion.',
    );
    // All following policy changes exist ONLY in the disposable database.
    query(`create policy isolated_reservation_gate on storage.objects as restrictive for insert to authenticated
    with check(bucket_id not in('post-media','post-videos','post-video-thumbnails') or private.can_use_family_media_reservation(bucket_id,name));`);
    r = await upload('owner', path('owner', 'legacy-after-require-session'));
    assert.ok(
      !r.ok,
      'A reservation-only policy would break an unmodified legacy client.',
    );
    console.log(
      'BLOCKER EVIDENCE: requiring a quota session rejects the old direct-upload path; such a policy is absent from the forward migration.',
    );
    const reserve = (label, video = false) =>
      auth(
        'owner',
        `select public.reserve_family_media_upload(${quote(id('session-' + label))}::uuid,${quote(id('pet'))}::uuid,
    ${quote(id('post-' + label))}::uuid,${video ? "'{}'::uuid[]" : `array[${quote(id(label))}::uuid]`},${video ? `${quote(id(label))}::uuid` : 'null'});`,
      );
    reserve('protocol-photo');
    const protocolPhoto = path('owner', 'protocol-photo');
    r = await upload('owner', protocolPhoto);
    assert.ok(r.ok, await r.text());
    const settled = auth(
      'owner',
      `select public.settle_family_media_upload(${quote(id('session-protocol-photo'))}::uuid);`,
    );
    assert.match(settled, /"actual_bytes": 4/u);
    auth(
      'owner',
      `select public.settle_family_media_upload(${quote(id('session-protocol-photo'))}::uuid);`,
    );
    const photoItem = {
      id: id('protocol-photo'),
      storage_path: protocolPhoto,
      position: 0,
      width: 10,
      height: 10,
      mime_type: 'image/jpeg',
    };
    auth(
      'owner',
      `select public.create_post(${quote(id('post-protocol-photo'))}::uuid,${quote(id('pet'))}::uuid,null,'other',current_date,null,${quote(JSON.stringify([photoItem]))}::jsonb);`,
    );
    assert.equal(
      query(
        `select status from private.family_media_upload_sessions where id=${quote(id('session-protocol-photo'))}::uuid;`,
      ),
      'published',
    );
    const beforeDeletion = Number(
      query(
        "select used_bytes from private.family_media_usage where family_id=public.rv2_id('family');",
      ),
    );
    query(
      `delete from public.posts where id=${quote(id('post-protocol-photo'))}::uuid;`,
    );
    assert.equal(
      Number(
        query(
          "select used_bytes from private.family_media_usage where family_id=public.rv2_id('family');",
        ),
      ),
      beforeDeletion,
    );
    r = await fetch(`${baseUrl}/object/post-media`, {
      method: 'DELETE',
      headers: { ...headers('owner'), 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: [protocolPhoto] }),
    });
    assert.ok(r.ok, await r.text());
    query(
      `update public.media_cleanup_jobs set completed_at=clock_timestamp() where source_post_id=${quote(id('post-protocol-photo'))}::uuid;`,
    );
    assert.equal(
      Number(
        query(
          "select used_bytes from private.family_media_usage where family_id=public.rv2_id('family');",
        ),
      ),
      beforeDeletion - 4,
    );
    console.log(
      'PASS: real new-protocol reservation -> Storage upload -> trusted settlement -> unchanged Post RPC -> Storage API cleanup -> byte release.',
    );
    query(
      "update private.family_media_quota_policy set video_calendar_time_zone='Asia/Hong_Kong',video_counting_scope='all_successful',metering_started_at='2020-01-01';",
    );
    reserve('protocol-video', true);
    const protocolVideo = await start('owner', 'protocol-video');
    r = await patch(protocolVideo, 0, media.subarray(0, 2));
    assert.equal(r.status, 204);
    r = await fetch(protocolVideo.url, {
      method: 'HEAD',
      headers: { ...headers('owner'), 'tus-resumable': '1.0.0' },
    });
    assert.equal(r.headers.get('upload-offset'), '2');
    r = await patch(protocolVideo, 2, media.subarray(2));
    assert.equal(r.status, 204);
    const thumbnail = path('owner', 'protocol-video');
    r = await fetch(`${baseUrl}/object/post-video-thumbnails/${thumbnail}`, {
      method: 'POST',
      headers: { ...headers('owner'), 'content-type': 'image/jpeg' },
      body: new Uint8Array([255, 216, 255, 217]),
    });
    assert.ok(r.ok, await r.text());
    const settledVideo = auth(
      'owner',
      `select public.settle_family_media_upload(${quote(id('session-protocol-video'))}::uuid);`,
    );
    assert.match(settledVideo, /"actual_bytes": 28/u);
    const videoItem = {
      id: id('protocol-video'),
      storage_path: protocolVideo.name,
      thumbnail_path: thumbnail,
      duration_ms: 1000,
      width: 10,
      height: 10,
      mime_type: 'video/mp4',
    };
    auth(
      'owner',
      `select public.create_post_v2(${quote(id('post-protocol-video'))}::uuid,${quote(id('pet'))}::uuid,null,'other',current_date,null,'[]',${quote(JSON.stringify(videoItem))}::jsonb);`,
    );
    assert.equal(
      Number(
        query(
          `select count(*) from private.family_video_publications where post_id=${quote(id('post-protocol-video'))}::uuid;`,
        ),
      ),
      1,
    );
    r = await fetch(
      `${baseUrl}/object/authenticated/post-media/${path('owner', 'photo')}`,
      {
        headers: headers('owner'),
      },
    );
    assert.ok(r.ok, 'Historical photo download remains available.');
    console.log(
      'PASS: quota-aware TUS resume + thumbnail + actual settlement + successful video publication; historical download remains available.',
    );
    reserve('protocol-expired', true);
    const sessionTUS = await start('owner', 'protocol-expired');
    r = await patch(sessionTUS, 0, media.subarray(0, 2));
    assert.equal(r.status, 204);
    query(
      `update private.family_media_upload_sessions set expires_at=clock_timestamp()-interval '1 second' where id=${quote(id('session-protocol-expired'))}::uuid;`,
    );
    r = await patch(sessionTUS, 2, media.subarray(2));
    assert.ok(
      !r.ok,
      'Expired protocol grant denies late TUS completion even when TUS TTL does not.',
    );
    r = await fetch(sessionTUS.url, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token('owner', 'service_role')}`,
        'tus-resumable': '1.0.0',
      },
    });
    assert.equal(r.status, 204, await r.text());
    r = await fetch(sessionTUS.url, {
      method: 'HEAD',
      headers: {
        authorization: `Bearer ${token('owner', 'service_role')}`,
        'tus-resumable': '1.0.0',
      },
    });
    assert.ok(!r.ok, 'Trusted service confirms transport no longer exists.');
    query(
      `select public.release_closed_family_media_upload(${quote(id('session-protocol-expired'))}::uuid);`,
    );
    assert.equal(
      query(
        `select video_slot_held from private.family_media_upload_sessions where id=${quote(id('session-protocol-expired'))}::uuid;`,
      ),
      'f',
    );
    console.log(
      'PASS: expired protocol grant rejects late chunks; service TUS termination/absence proof releases the temporary video slot.',
    );
  },
  {
    storage: true,
    tusExpiryMs: 12_000,
    migration:
      'supabase/migrations/20261014104554_family_storage_quota_prototype.sql',
  },
);
