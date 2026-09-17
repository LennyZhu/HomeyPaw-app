import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const read = (path) => readFile(resolve(process.cwd(), path), 'utf8');

const [
  cache,
  postQueries,
  postMedia,
  preview,
  viewer,
  detail,
  home,
  journal,
  petQueries,
  petAvatar,
  profileAvatar,
  familyQueries,
  chatQueries,
  scheduleApi,
  cleanup,
  postBucketMigration,
  petBucketMigration,
  profileBucketMigration,
] = await Promise.all([
  read('src/features/media/storage-signed-url.ts'),
  read('src/features/posts/post-queries.ts'),
  read('src/features/posts/post-media.ts'),
  read('src/features/posts/components/post-media-preview.tsx'),
  read('src/features/posts/components/post-photo-viewer.tsx'),
  read('src/features/posts/post-detail-screen.tsx'),
  read('src/features/home/home-screen.tsx'),
  read('src/features/journal/journal-screen.tsx'),
  read('src/features/pets/pet-queries.ts'),
  read('src/features/pets/components/pet-avatar.tsx'),
  read('src/features/profile/profile-avatar.ts'),
  read('src/features/family/family-queries.ts'),
  read('src/features/chat/chat-queries.ts'),
  read('src/features/schedule/care-schedule-api.ts'),
  read('src/features/pets/pet-access-cleanup.ts'),
  read('supabase/migrations/20260823150000_create_posts.sql'),
  read('supabase/migrations/20260823090000_create_pets.sql'),
  read('supabase/migrations/20260909100000_user_profile_avatars.sql'),
]);

assert.match(cache, /all: \['storage-signed-url'\]/u);
assert.match(cache, /storageSignedUrlKeys\.path\(bucket, path\)/u);
assert.match(cache, /storageSignedUrlTtlSeconds = 60 \* 60/u);
assert.match(cache, /storageSignedUrlStaleTimeMs = 55 \* 60_000/u);
assert.match(cache, /storageSignedUrlGcTimeMs = 6 \* 60 \* 60_000/u);
assert.match(cache, /refetchOnWindowFocus: false/u);
assert.match(cache, /refetchOnReconnect: false/u);
assert.match(cache, /refetchOnMount: true/u);
assert.match(cache, /exact: true/u);
assert.match(cache, /createStorageImageCacheKey/u);
assert.match(cache, /cacheKey: createStorageImageCacheKey\(bucket, path\)/u);
assert.doesNotMatch(cache, /getPublicUrl/u);
console.log(
  'PASS: private Storage URLs use one bucket/path cache with a one-hour TTL, 55-minute freshness, exact recovery, and stable image cache keys.',
);

assert.match(
  postQueries,
  /useStorageSignedUrls\(postMediaBucket, storagePaths\)/u,
);
assert.doesNotMatch(postQueries, /mediaUrls:/u);
assert.doesNotMatch(postMedia, /createPostMediaSignedUrls/u);
for (const source of [preview, viewer, detail]) {
  assert.match(source, /createStorageImageSource/u);
  assert.match(source, /cachePolicy="memory-disk"/u);
}
for (const source of [home, journal, detail]) {
  assert.match(source, /refetchPath\(storagePath\)/u);
  assert.doesNotMatch(source, /mediaUrlsQuery\.refetch\(\)/u);
  assert.doesNotMatch(source, /urlsQuery\.refetch\(\)/u);
}
assert.doesNotMatch(journal, /mediaUrlsQuery\.refetch\(\)/u);
console.log(
  'PASS: Home, Journal, Detail, preview, and viewer share per-object photo URLs and refresh only the failed object.',
);

assert.match(petQueries, /useStorageSignedUrl\(petAvatarBucket, objectPath\)/u);
assert.match(petAvatar, /createStorageImageSource\(petAvatarBucket/u);
assert.match(
  profileAvatar,
  /getStorageSignedUrls\(queryClient, profileAvatarBucket, objectPaths\)/u,
);
assert.match(
  profileAvatar,
  /useStorageSignedUrl\(profileAvatarBucket, objectPath\)/u,
);
for (const source of [familyQueries, chatQueries, scheduleApi]) {
  assert.match(source, /createProfileAvatarSignedUrls\(/u);
  assert.match(source, /queryClient/u);
}
console.log(
  'PASS: pet, profile, family, chat, and schedule avatars reuse the same private object URL cache.',
);

assert.match(
  cleanup,
  /cancelQueries\(\{ queryKey: storageSignedUrlKeys\.all \}\)/u,
);
assert.match(
  cleanup,
  /removeQueries\(\{ queryKey: storageSignedUrlKeys\.all \}\)/u,
);
assert.match(postMedia, /cacheControl: '3600'/u);
for (const [migration, bucket] of [
  [postBucketMigration, 'post-media'],
  [petBucketMigration, 'pet-avatars'],
  [profileBucketMigration, 'profile-avatars'],
]) {
  assert.match(migration, new RegExp(`'${bucket}'[\\s\\S]*?false`, 'u'));
  assert.match(migration, /set\s+public = false/u);
}
assert.doesNotMatch(
  [cache, postQueries, postMedia, petQueries, profileAvatar].join('\n'),
  /getPublicUrl/u,
);
console.log(
  'PASS: Removed Member purges signed URL memory cache; buckets remain private and upload cache-control stays unchanged.',
);
