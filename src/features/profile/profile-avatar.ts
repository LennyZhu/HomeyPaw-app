import type { QueryClient } from '@tanstack/react-query';
import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';

import type { PreparedAvatarImage } from '@/features/media/avatar-image';
import {
  getStorageSignedUrls,
  storageSignedUrlKeys,
  useStorageSignedUrl,
} from '@/features/media/storage-signed-url';
import { requireSupabase } from '@/lib/supabase/client';

export const profileAvatarBucket = 'profile-avatars';

export const profileAvatarKeys = {
  all: (_userId: string | undefined) =>
    storageSignedUrlKeys.bucket(profileAvatarBucket),
  signed: (_userId: string | undefined, objectPath: string | null) =>
    storageSignedUrlKeys.path(profileAvatarBucket, objectPath ?? ''),
};

export async function uploadProfileAvatar({
  avatar,
  userId,
}: {
  avatar: PreparedAvatarImage;
  userId: string;
}) {
  if (!avatar.base64) throw new Error('PHOTO_ENCODING_FAILED');

  const objectPath = `${userId}/${Crypto.randomUUID()}.jpg`;
  const { error } = await requireSupabase()
    .storage.from(profileAvatarBucket)
    .upload(objectPath, decode(avatar.base64), {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) throw error;
  return objectPath;
}

export async function removeProfileAvatar(objectPath: string) {
  const { error } = await requireSupabase()
    .storage.from(profileAvatarBucket)
    .remove([objectPath]);
  if (error) throw error;
}

export function createProfileAvatarSignedUrls(
  queryClient: QueryClient,
  objectPaths: string[],
) {
  return getStorageSignedUrls(queryClient, profileAvatarBucket, objectPaths);
}

export function useProfileAvatarUrl(objectPath: string | null) {
  return useStorageSignedUrl(profileAvatarBucket, objectPath);
}
