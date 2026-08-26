import * as Crypto from 'expo-crypto';

import { requireSupabase } from '@/lib/supabase/client';
import type { Json, Post, PostMedia } from '@/types/database';

import {
  type PostMediaDraft,
  type UploadedPostMedia,
  preparePostPhoto,
  removePostMedia,
  uploadPostPhoto,
} from './post-media';
import type { PostFormValues } from './post-schema';

export type PublishProgress =
  | { completed: number; stage: 'processing'; total: number }
  | { completed: number; stage: 'uploading'; total: number }
  | { stage: 'saving' };

type PublishContext = {
  media: PostMediaDraft[];
  petId: string;
  userId: string;
  values: PostFormValues;
  onProgress?: (progress: PublishProgress) => void;
};

async function cleanupNewUploads(storagePaths: string[]) {
  try {
    await removePostMedia(storagePaths);
  } catch {
    throw new Error('POST_MEDIA_CLEANUP_FAILED');
  }
}

async function prepareAndUploadNewMedia({
  media,
  petId,
  postId,
  userId,
  onProgress,
}: {
  media: PostMediaDraft[];
  onProgress: ((progress: PublishProgress) => void) | undefined;
  petId: string;
  postId: string;
  userId: string;
}) {
  const newMedia = media.filter((item) => item.kind === 'new');
  const prepared = [];

  for (let index = 0; index < newMedia.length; index += 1) {
    onProgress?.({
      completed: index,
      stage: 'processing',
      total: newMedia.length,
    });
    const result = await preparePostPhoto(newMedia[index]!);
    prepared.push({ draft: newMedia[index]!, result });
    onProgress?.({
      completed: index + 1,
      stage: 'processing',
      total: newMedia.length,
    });
  }

  const uploaded = new Map<string, UploadedPostMedia>();
  const uploadedPaths: string[] = [];

  try {
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index]!;
      onProgress?.({
        completed: index,
        stage: 'uploading',
        total: prepared.length,
      });
      const result = await uploadPostPhoto({
        base64: item.result.base64!,
        height: item.result.height,
        mediaId: item.draft.id,
        petId,
        postId,
        userId,
        width: item.result.width,
      });
      uploadedPaths.push(result.storagePath);
      uploaded.set(item.draft.id, {
        height: result.height,
        id: item.draft.id,
        mime_type: 'image/jpeg',
        position: 0,
        storage_path: result.storagePath,
        width: result.width,
      });

      onProgress?.({
        completed: index + 1,
        stage: 'uploading',
        total: prepared.length,
      });
    }

    return { uploaded, uploadedPaths };
  } catch (error) {
    await cleanupNewUploads(uploadedPaths);
    throw error;
  }
}

function buildMediaItems(
  media: PostMediaDraft[],
  uploaded: Map<string, UploadedPostMedia>,
) {
  return media.map((item, position) => {
    if (item.kind === 'existing') {
      return {
        height: item.height,
        id: item.id,
        mime_type: 'image/jpeg',
        position,
        storage_path: item.storagePath,
        width: item.width,
      } satisfies UploadedPostMedia;
    }

    const uploadedItem = uploaded.get(item.id);

    if (!uploadedItem) {
      throw new Error('POST_MEDIA_UPLOAD_INCOMPLETE');
    }

    return { ...uploadedItem, position } satisfies UploadedPostMedia;
  });
}

function postValuesToRpc(values: PostFormValues) {
  return {
    post_content: values.content.trim() || null,
    post_event_date: values.eventDate,
    post_location_name: values.locationName.trim() || null,
    post_tag: values.tag,
  };
}

export async function publishPost(context: PublishContext) {
  const postId = Crypto.randomUUID();
  const { uploaded, uploadedPaths } = await prepareAndUploadNewMedia({
    media: context.media,
    onProgress: context.onProgress,
    petId: context.petId,
    postId,
    userId: context.userId,
  });

  try {
    context.onProgress?.({ stage: 'saving' });
    const { data, error } = await requireSupabase().rpc('create_post', {
      ...postValuesToRpc(context.values),
      media_items: buildMediaItems(context.media, uploaded) as unknown as Json,
      post_id: postId,
      post_pet_id: context.petId,
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    await cleanupNewUploads(uploadedPaths);
    throw error;
  }
}

export async function savePostEdit({
  originalMedia,
  post,
  ...context
}: PublishContext & {
  originalMedia: PostMedia[];
  post: Post;
}) {
  const { uploaded, uploadedPaths } = await prepareAndUploadNewMedia({
    media: context.media,
    onProgress: context.onProgress,
    petId: context.petId,
    postId: post.id,
    userId: post.author_id,
  });

  try {
    context.onProgress?.({ stage: 'saving' });
    const mediaItems = buildMediaItems(context.media, uploaded);
    const { data, error } = await requireSupabase().rpc('update_post', {
      ...postValuesToRpc(context.values),
      media_items: mediaItems as unknown as Json,
      target_post_id: post.id,
    });

    if (error) {
      throw error;
    }

    const retainedPaths = new Set(mediaItems.map((item) => item.storage_path));
    const removedPaths = originalMedia
      .map((item) => item.storage_path)
      .filter((path) => !retainedPaths.has(path));

    let mediaCleanupPending = false;

    try {
      await removePostMedia(removedPaths);
    } catch {
      mediaCleanupPending = true;
    }

    return { mediaCleanupPending, post: data };
  } catch (error) {
    await cleanupNewUploads(uploadedPaths);
    throw error;
  }
}
