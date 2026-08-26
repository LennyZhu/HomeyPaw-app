import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { requireSupabase } from '@/lib/supabase/client';
import type { PostMedia } from '@/types/database';

export const postMediaBucket = 'post-media';
export const maximumPostMedia = 9;

export type NewPostMediaDraft = {
  height: number;
  id: string;
  kind: 'new';
  uri: string;
  width: number;
};

export type ExistingPostMediaDraft = {
  height: number;
  id: string;
  kind: 'existing';
  storagePath: string;
  uri: string;
  width: number;
};

export type PostMediaDraft = ExistingPostMediaDraft | NewPostMediaDraft;

export type UploadedPostMedia = {
  height: number;
  id: string;
  mime_type: 'image/jpeg';
  position: number;
  storage_path: string;
  width: number;
};

export type PhotoPermissionError =
  'PHOTO_PERMISSION_DENIED' | 'PHOTO_PERMISSION_LIMITED';

export async function pickPostPhotos(remainingSlots: number) {
  if (remainingSlots <= 0) {
    return { accessPrivileges: null, photos: [] };
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error('PHOTO_PERMISSION_DENIED' satisfies PhotoPermissionError);
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: true,
    exif: false,
    mediaTypes: ['images'],
    orderedSelection: true,
    quality: 1,
    selectionLimit: remainingSlots,
  });

  if (result.canceled) {
    return {
      accessPrivileges: permission.accessPrivileges,
      photos: [],
    };
  }

  return {
    accessPrivileges: permission.accessPrivileges,
    photos: result.assets.slice(0, remainingSlots).map((asset) => ({
      height: asset.height,
      id: Crypto.randomUUID(),
      kind: 'new' as const,
      uri: asset.uri,
      width: asset.width,
    })),
  };
}

export async function preparePostPhoto(photo: NewPostMediaDraft) {
  const context = ImageManipulator.manipulate(photo.uri);
  const longestEdge = Math.max(photo.width, photo.height);

  if (longestEdge > 2048) {
    if (photo.width >= photo.height) {
      context.resize({ height: null, width: 2048 });
    } else {
      context.resize({ height: 2048, width: null });
    }
  }

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    base64: true,
    compress: 0.85,
    format: SaveFormat.JPEG,
  });

  if (!result.base64) {
    throw new Error('PHOTO_ENCODING_FAILED');
  }

  return result;
}

export async function uploadPostPhoto({
  base64,
  height,
  mediaId,
  petId,
  postId,
  userId,
  width,
}: {
  base64: string;
  height: number;
  mediaId: string;
  petId: string;
  postId: string;
  userId: string;
  width: number;
}) {
  const storagePath = `${userId}/${petId}/${postId}/${mediaId}.jpg`;
  const { error } = await requireSupabase()
    .storage.from(postMediaBucket)
    .upload(storagePath, decode(base64), {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return { height, storagePath, width };
}

export async function removePostMedia(storagePaths: string[]) {
  if (storagePaths.length === 0) {
    return;
  }

  for (let index = 0; index < storagePaths.length; index += 100) {
    const { error } = await requireSupabase()
      .storage.from(postMediaBucket)
      .remove(storagePaths.slice(index, index + 100));

    if (error) {
      throw error;
    }
  }
}

export async function createPostMediaSignedUrls(storagePaths: string[]) {
  if (storagePaths.length === 0) {
    return {} as Record<string, string>;
  }

  const { data, error } = await requireSupabase()
    .storage.from(postMediaBucket)
    .createSignedUrls(storagePaths, 3600);

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    data.flatMap((item, index) => {
      const path = storagePaths[index];
      return path && item.signedUrl ? [[path, item.signedUrl]] : [];
    }),
  );
}

export function existingMediaToDraft(
  media: PostMedia,
  signedUrl: string,
): ExistingPostMediaDraft {
  return {
    height: media.height,
    id: media.id,
    kind: 'existing',
    storagePath: media.storage_path,
    uri: signedUrl,
    width: media.width,
  };
}
