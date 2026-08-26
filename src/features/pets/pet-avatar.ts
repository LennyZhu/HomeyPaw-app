import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import {
  ImageManipulator,
  SaveFormat,
  type ImageResult,
} from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { requireSupabase } from '@/lib/supabase/client';

export const petAvatarBucket = 'pet-avatars';

export type PreparedPetAvatar = Pick<
  ImageResult,
  'base64' | 'height' | 'uri' | 'width'
>;

export async function pickAndPreparePetAvatar() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error('PHOTO_PERMISSION_DENIED');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: true,
    aspect: [1, 1],
    mediaTypes: ['images'],
    quality: 1,
  });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];

  if (!asset) {
    throw new Error('PHOTO_SELECTION_EMPTY');
  }

  const squareSize = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);

  context
    .crop({
      height: squareSize,
      originX: Math.max(0, (asset.width - squareSize) / 2),
      originY: Math.max(0, (asset.height - squareSize) / 2),
      width: squareSize,
    })
    .resize({ height: 1024, width: 1024 });

  const rendered = await context.renderAsync();

  return rendered.saveAsync({
    base64: true,
    compress: 0.82,
    format: SaveFormat.JPEG,
  });
}

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
