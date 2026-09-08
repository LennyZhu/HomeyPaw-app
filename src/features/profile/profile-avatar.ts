import { useQuery } from '@tanstack/react-query';
import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';

import { useAuth } from '@/features/auth/auth-context';
import type { PreparedAvatarImage } from '@/features/media/avatar-image';
import { requireSupabase } from '@/lib/supabase/client';

export const profileAvatarBucket = 'profile-avatars';

export const profileAvatarKeys = {
  all: (userId: string | undefined) => ['profile-avatar', userId] as const,
  signed: (userId: string | undefined, objectPath: string | null) =>
    [...profileAvatarKeys.all(userId), objectPath] as const,
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

export async function createProfileAvatarSignedUrls(objectPaths: string[]) {
  const paths = [...new Set(objectPaths.filter(Boolean))];
  if (paths.length === 0) return {};

  const { data, error } = await requireSupabase()
    .storage.from(profileAvatarBucket)
    .createSignedUrls(paths, 3600);
  if (error) throw error;

  return Object.fromEntries(
    data.flatMap((item) =>
      item.signedUrl ? [[item.path, item.signedUrl] as const] : [],
    ),
  );
}

export function useProfileAvatarUrl(objectPath: string | null) {
  const { user } = useAuth();
  return useQuery({
    enabled: Boolean(user && objectPath),
    gcTime: 3_600_000,
    queryFn: async () => {
      const urls = await createProfileAvatarSignedUrls([objectPath!]);
      return urls[objectPath!] ?? null;
    },
    queryKey: profileAvatarKeys.signed(user?.id, objectPath),
    staleTime: 3_000_000,
  });
}
