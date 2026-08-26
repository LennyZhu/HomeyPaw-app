import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const fixtureName = 'HomeyPaw Phase 5 Verification Pet';
const fixtureDescription = 'Temporary Phase 5 memory and pagination fixture';
const pageSize = 10;

function readPublicConfig() {
  const contents = readFileSync(
    new URL('../.env.local', import.meta.url),
    'utf8',
  );
  const values = new Map();
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) values.set(match[1], match[2].trim());
  }
  return {
    publishableKey: values.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    url: values.get('EXPO_PUBLIC_SUPABASE_URL'),
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing temporary test credential: ${name}`);
  return value;
}

function client(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function signIn(supabase, email, password, label) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user)
    throw new Error(`${label} sign-in failed (${error?.code ?? 'no_user'}).`);
  return data.user;
}

function toDateOnly(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addLocalDays(date, days) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    12,
  );
}

function historicalSameDay(today) {
  for (let years = 1; years <= 4; years += 1) {
    const candidate = new Date(
      today.getFullYear() - years,
      today.getMonth(),
      today.getDate(),
      12,
    );
    if (
      candidate.getMonth() === today.getMonth() &&
      candidate.getDate() === today.getDate()
    ) {
      return { date: toDateOnly(candidate), years };
    }
  }
  throw new Error('Could not create a historical same-day fixture.');
}

async function createPost(supabase, petId, eventDate, content) {
  const postId = randomUUID();
  const { data, error } = await supabase.rpc('create_post', {
    media_items: [],
    post_content: content,
    post_event_date: eventDate,
    post_id: postId,
    post_location_name: null,
    post_pet_id: petId,
    post_tag: 'other',
  });
  if (error || !data)
    throw new Error(`Post fixture creation failed (${error?.code}).`);
  return postId;
}

async function getMemory(supabase, petId, localToday) {
  return supabase.rpc('get_pet_memory', {
    local_today: localToday,
    target_pet_id: petId,
  });
}

async function deletePet(supabase, petId) {
  const { data, error } = await supabase.functions.invoke('delete-pet', {
    body: { petId },
  });
  if (error || !data?.deleted)
    throw new Error('Temporary Phase 5 pet cleanup failed.');
}

async function removeStalePets(supabase) {
  const { data, error } = await supabase
    .from('pets')
    .select('id')
    .eq('name', fixtureName)
    .eq('description', fixtureDescription);
  if (error) throw new Error('Could not inspect stale Phase 5 fixtures.');
  for (const pet of data) await deletePet(supabase, pet.id);
}

async function fetchAllPostIds(supabase, petId) {
  const ids = [];
  let cursor = null;
  while (true) {
    let query = supabase
      .from('posts')
      .select('id, event_date, created_at')
      .eq('pet_id', petId)
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize + 1);
    if (cursor) {
      query = query.or(
        `event_date.lt.${cursor.event_date},and(event_date.eq.${cursor.event_date},created_at.lt.${cursor.created_at}),and(event_date.eq.${cursor.event_date},created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(`Cursor page failed (${error.code}).`);
    const page = data.slice(0, pageSize);
    ids.push(...page.map((post) => post.id));
    if (data.length <= pageSize || page.length === 0) break;
    cursor = page.at(-1);
  }
  return ids;
}

async function main() {
  const { publishableKey, url } = readPublicConfig();
  if (!publishableKey || !url)
    throw new Error('Public Supabase configuration is missing.');

  const owner = client(url, publishableKey);
  const member = client(url, publishableKey);
  const stranger = client(url, publishableKey);
  const ownerEmail = requiredEnvironment('PAWDAY_FAMILY_OWNER_EMAIL');
  const ownerPassword = requiredEnvironment('PAWDAY_FAMILY_OWNER_PASSWORD');
  const memberEmail = requiredEnvironment('PAWDAY_FAMILY_MEMBER_EMAIL');
  const memberPassword = requiredEnvironment('PAWDAY_FAMILY_MEMBER_PASSWORD');
  const strangerEmail = requiredEnvironment('PAWDAY_FAMILY_STRANGER_EMAIL');
  const strangerPassword = requiredEnvironment(
    'PAWDAY_FAMILY_STRANGER_PASSWORD',
  );
  let petId = null;

  try {
    await signIn(owner, ownerEmail, ownerPassword, 'Owner');
    const memberUser = await signIn(
      member,
      memberEmail,
      memberPassword,
      'Member',
    );
    await signIn(stranger, strangerEmail, strangerPassword, 'Stranger');
    await removeStalePets(owner);

    const { data: pet, error: petError } = await owner.rpc('create_pet', {
      pet_description: fixtureDescription,
      pet_gender: 'unknown',
      pet_name: fixtureName,
      pet_species: 'other',
    });
    if (petError || !pet)
      throw new Error(`Temporary pet creation failed (${petError?.code}).`);
    petId = pet.id;

    const { data: inviteRows, error: inviteError } = await owner.rpc(
      'create_pet_invite',
      {
        target_pet_id: petId,
      },
    );
    const invite = inviteRows?.[0];
    if (inviteError || !invite)
      throw new Error('Temporary family invite creation failed.');
    const { error: joinError } = await member.rpc('join_pet_with_invite', {
      invite_code: invite.invite_code,
    });
    if (joinError)
      throw new Error(`Temporary member join failed (${joinError.code}).`);

    const today = new Date();
    const localToday = toDateOnly(today);
    const sameDay = historicalSameDay(today);
    const fallbackId = await createPost(
      owner,
      petId,
      toDateOnly(addLocalDays(today, -31)),
      'Phase 5 recent memory fallback',
    );
    const exactId = await createPost(
      owner,
      petId,
      sameDay.date,
      'Phase 5 on-this-day memory',
    );

    for (let index = 0; index < 23; index += 1) {
      await createPost(
        owner,
        petId,
        toDateOnly(addLocalDays(today, -(index % 20))),
        `Phase 5 cursor post ${index + 1}`,
      );
    }

    const ownerMemory = await getMemory(owner, petId, localToday);
    if (
      ownerMemory.error ||
      ownerMemory.data?.[0]?.memory_post_id !== exactId ||
      ownerMemory.data[0].memory_kind !== 'on_this_day' ||
      ownerMemory.data[0].memory_years_ago !== sameDay.years
    ) {
      throw new Error('Owner did not receive the correct on-this-day memory.');
    }
    const memberMemory = await getMemory(member, petId, localToday);
    if (
      memberMemory.error ||
      memberMemory.data?.[0]?.memory_post_id !== exactId
    ) {
      throw new Error('Member did not receive the shared on-this-day memory.');
    }
    const strangerMemory = await getMemory(stranger, petId, localToday);
    if (!strangerMemory.error || (strangerMemory.data?.length ?? 0) > 0) {
      throw new Error('RLS BREACH: Stranger received private memory data.');
    }
    console.log(
      'PASS: Owner and Member can read On This Day; Stranger cannot.',
    );

    const allIds = await fetchAllPostIds(owner, petId);
    if (allIds.length < 25 || new Set(allIds).size !== allIds.length) {
      throw new Error('Cursor pagination skipped or duplicated Phase 5 posts.');
    }
    console.log(
      `PASS: Cursor pagination returned ${allIds.length} unique posts across multiple pages.`,
    );

    const { data: deleted, error: deleteError } = await owner.functions.invoke(
      'delete-post',
      {
        body: { postId: exactId },
      },
    );
    if (deleteError || !deleted?.deleted)
      throw new Error('On-this-day fixture deletion failed.');
    const fallbackMemory = await getMemory(owner, petId, localToday);
    if (
      fallbackMemory.error ||
      fallbackMemory.data?.[0]?.memory_post_id !== fallbackId ||
      fallbackMemory.data[0].memory_kind !== 'recent'
    ) {
      throw new Error(
        'Recent memory fallback did not select the expected post.',
      );
    }
    console.log(
      'PASS: Recent-memory fallback works when On This Day is empty.',
    );

    const { error: removeError } = await owner.rpc('remove_pet_member', {
      target_pet_id: petId,
      target_user_id: memberUser.id,
    });
    if (removeError)
      throw new Error(`Member removal failed (${removeError.code}).`);
    const removedMemory = await getMemory(member, petId, localToday);
    if (!removedMemory.error || (removedMemory.data?.length ?? 0) > 0) {
      throw new Error(
        'RLS BREACH: Removed Member retained fresh memory access.',
      );
    }
    console.log(
      'PASS: Removed Member loses fresh memory access without re-login.',
    );
  } finally {
    if (petId) await deletePet(owner, petId);
    await Promise.all([
      owner.auth.signOut(),
      member.auth.signOut(),
      stranger.auth.signOut(),
    ]);
  }

  console.log('PASS: Phase 5 memory and pagination fixtures are deleted.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
