import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';

import {
  pickAndPrepareAvatarImage,
  type PreparedAvatarImage,
} from '@/features/media/avatar-image';
import { requireSupabase } from '@/lib/supabase/client';

export const petAvatarBucket = 'pet-avatars';

export type PreparedPetAvatar = PreparedAvatarImage;
export const pickAndPreparePetAvatar = pickAndPrepareAvatarImage;

export async function uploadPetAvatar({
  avatar,
  petId,
  userId,
}: {
  avatar: PreparedPetAvatar;
  petId: string;
  userId: string;
}) {
  if (!avatar.base64) {
    throw new Error('PHOTO_ENCODING_FAILED');
  }

  const objectPath = `${userId}/${petId}/${Crypto.randomUUID()}.jpg`;
  const { error } = await requireSupabase()
    .storage.from(petAvatarBucket)
    .upload(objectPath, decode(avatar.base64), {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return objectPath;
}

export async function removePetAvatar(objectPath: string) {
  const { error } = await requireSupabase()
    .storage.from(petAvatarBucket)
    .remove([objectPath]);

  if (error) {
    throw error;
  }
}

export async function createPetAvatarSignedUrl(objectPath: string) {
  const { data, error } = await requireSupabase()
    .storage.from(petAvatarBucket)
    .createSignedUrl(objectPath, 3600);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}
