import * as Crypto from 'expo-crypto';

import { requireSupabase } from '@/lib/supabase/client';
import type { Json, Post, PostMedia, PostVideo } from '@/types/database';

import {
  type PostMediaDraft,
  type UploadedPostMedia,
  preparePostPhoto,
  removePostMedia,
  uploadPostPhoto,
} from './post-media';
import type { PostFormValues } from './post-schema';
import {
  logJournalVideoPublish,
  logJournalVideoPublishError,
  tagJournalVideoPublishError,
} from './video/post-video-publish-debug';
import {
  cleanupPostVideoUploads,
  getUploadedVideoPaths,
  recordPendingVideoOrphans,
  type PostVideoDraft,
  type UploadedPostVideo,
  uploadPostVideo,
} from './video/post-video-storage';

export type PublishProgress =
  | { completed: number; stage: 'processing'; total: number }
  | { completed: number; stage: 'uploading'; total: number }
  | { progress: number; stage: 'video-uploading' }
  | { stage: 'saving' };

type PublishContext = {
  media: PostMediaDraft[];
  petId: string;
  signal?: AbortSignal;
  userId: string;
  values: PostFormValues;
  video: PostVideoDraft | null;
  onProgress?: (progress: PublishProgress) => void;
};

async function cleanupNewPhotoUploads(storagePaths: string[]) {
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
    await cleanupNewPhotoUploads(uploadedPaths);
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
    if (!uploadedItem) throw new Error('POST_MEDIA_UPLOAD_INCOMPLETE');
    return { ...uploadedItem, position } satisfies UploadedPostMedia;
  });
}

function buildVideoItem(video: PostVideoDraft | UploadedPostVideo | null) {
  if (!video) return null;
  if ('storage_path' in video) return video;
  if (video.kind === 'new') throw new Error('POST_VIDEO_UPLOAD_INCOMPLETE');
  return {
    duration_ms: video.durationMs,
    height: video.height,
    id: video.id,
    mime_type: 'video/mp4' as const,
    storage_path: video.storagePath,
    thumbnail_path: video.thumbnailPath,
    width: video.width,
  };
}

function postValuesToRpc(values: PostFormValues) {
  return {
    post_content: values.content.trim() || null,
    post_event_date: values.eventDate,
    post_location_name: values.locationName.trim() || null,
    post_tag: values.tag,
  };
}

async function cleanupRemovedPhotos(
  originalMedia: PostMedia[],
  mediaItems: UploadedPostMedia[],
) {
  const retainedPaths = new Set(mediaItems.map((item) => item.storage_path));
  const removedPaths = originalMedia
    .map((item) => item.storage_path)
    .filter((path) => !retainedPaths.has(path));
  try {
    await removePostMedia(removedPaths);
    return false;
  } catch {
    return true;
  }
}

async function cleanupUploadedVideo(
  video: UploadedPostVideo,
  context: Pick<PublishContext, 'petId' | 'userId'> & { postId: string },
) {
  return cleanupPostVideoUploads({
    paths: getUploadedVideoPaths(video),
    petId: context.petId,
    postId: context.postId,
    reason: 'cleanup-failed',
    userId: context.userId,
  });
}

async function reconcileVideoCommit({
  error,
  petId,
  postId,
  uploadedVideo,
  userId,
}: {
  error: unknown;
  petId: string;
  postId: string;
  uploadedVideo: UploadedPostVideo;
  userId: string;
}): Promise<Post> {
  let result;
  try {
    result = await requireSupabase()
      .from('posts')
      .select('*, post_videos(storage_path)')
      .eq('id', postId)
      .eq('pet_id', petId)
      .eq('author_id', userId)
      .maybeSingle();
  } catch (verificationError) {
    const tagged = tagJournalVideoPublishError(
      'verify_ambiguous_commit',
      verificationError,
    );
    logJournalVideoPublishError('verify_ambiguous_commit', tagged, {
      outcome: 'unable_to_confirm',
      postId,
    });
    throw tagged;
  }

  if (result.error) {
    logJournalVideoPublishError('verify_ambiguous_commit', result.error, {
      outcome: 'unable_to_confirm',
      postId,
    });
    try {
      await recordPendingVideoOrphans(
        getUploadedVideoPaths(uploadedVideo).map((path) => ({
          ...path,
          createdAt: new Date().toISOString(),
          petId,
          postId,
          reason: 'commit-unknown' as const,
          userId,
        })),
      );
    } catch {
      // Preserve uploaded objects when commit status cannot be determined.
    }
    throw tagJournalVideoPublishError(
      'verify_ambiguous_commit',
      new Error('POST_VIDEO_PUBLISH_UNCERTAIN'),
    );
  }

  const relation = result.data?.post_videos;
  const committedPath = Array.isArray(relation)
    ? relation[0]?.storage_path
    : relation?.storage_path;
  if (result.data && committedPath === uploadedVideo.storage_path) {
    logJournalVideoPublish('verify_ambiguous_commit', 'result', {
      committed: true,
      postId,
    });
    const { post_videos: _video, ...post } = result.data;
    return post as Post;
  }

  logJournalVideoPublish('verify_ambiguous_commit', 'result', {
    committed: false,
    postId,
  });

  const cleanup = await cleanupUploadedVideo(uploadedVideo, {
    petId,
    postId,
    userId,
  });
  if (cleanup.cleanupPending) {
    throw tagJournalVideoPublishError(
      'cleanup_orphan',
      new Error('POST_VIDEO_CLEANUP_FAILED'),
    );
  }
  throw error;
}

async function uploadNewVideoIfNeeded(context: PublishContext, postId: string) {
  if (!context.video || context.video.kind === 'existing') return null;
  context.onProgress?.({ progress: 0, stage: 'video-uploading' });
  return uploadPostVideo({
    draft: context.video,
    onProgress: (progress) =>
      context.onProgress?.({ progress, stage: 'video-uploading' }),
    petId: context.petId,
    postId,
    userId: context.userId,
    ...(context.signal ? { signal: context.signal } : {}),
  });
}

export async function publishPost(context: PublishContext) {
  const postId = Crypto.randomUUID();
  if (context.video && context.media.length > 0)
    throw new Error('POST_MIXED_MEDIA_NOT_ALLOWED');

  if (context.video) {
    const uploadedVideo = await uploadNewVideoIfNeeded(context, postId);
    if (!uploadedVideo) throw new Error('POST_VIDEO_UPLOAD_INCOMPLETE');
    if (context.signal?.aborted) {
      const cleanup = await cleanupUploadedVideo(uploadedVideo, {
        ...context,
        postId,
      });
      if (cleanup.cleanupPending) {
        throw tagJournalVideoPublishError(
          'cleanup_orphan',
          new Error('POST_VIDEO_CLEANUP_FAILED'),
        );
      }
      throw new Error('VIDEO_UPLOAD_CANCELLED');
    }
    context.onProgress?.({ stage: 'saving' });
    const videoItem = buildVideoItem(uploadedVideo);
    const rpcArguments = {
      ...postValuesToRpc(context.values),
      media_items: [] as unknown as Json,
      post_id: postId,
      post_pet_id: context.petId,
      video_item: videoItem as unknown as Json,
    };
    let rpcResult;
    try {
      rpcResult = await requireSupabase().rpc('create_post_v2', rpcArguments);
    } catch (error) {
      const tagged = tagJournalVideoPublishError('create_post_v2', error);
      logJournalVideoPublishError('create_post_v2', tagged, { postId });
      return reconcileVideoCommit({
        error: tagged,
        petId: context.petId,
        postId,
        uploadedVideo,
        userId: context.userId,
      });
    }
    const { data, error } = rpcResult;
    if (!error) return data;
    const tagged = tagJournalVideoPublishError('create_post_v2', error);
    logJournalVideoPublishError('create_post_v2', tagged, { postId });
    return reconcileVideoCommit({
      error: tagged,
      petId: context.petId,
      postId,
      uploadedVideo,
      userId: context.userId,
    });
  }

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
    if (error) throw error;
    return data;
  } catch (error) {
    await cleanupNewPhotoUploads(uploadedPaths);
    throw error;
  }
}

export async function savePostEdit({
  originalMedia,
  originalVideo,
  post,
  ...context
}: PublishContext & {
  originalMedia: PostMedia[];
  originalVideo: PostVideo | null;
  post: Post;
}) {
  if (context.video && context.media.length > 0)
    throw new Error('POST_MIXED_MEDIA_NOT_ALLOWED');
  if (!post.author_id) throw new Error('POST_AUTHOR_UNAVAILABLE');
  const { uploaded, uploadedPaths } = await prepareAndUploadNewMedia({
    media: context.media,
    onProgress: context.onProgress,
    petId: context.petId,
    postId: post.id,
    userId: post.author_id,
  });
  let uploadedVideo: UploadedPostVideo | null = null;
  let skipPhotoCleanup = false;

  try {
    uploadedVideo = await uploadNewVideoIfNeeded(context, post.id);
    if (context.signal?.aborted) throw new Error('VIDEO_UPLOAD_CANCELLED');
    context.onProgress?.({ stage: 'saving' });
    const mediaItems = buildMediaItems(context.media, uploaded);
    const usesVideoRpc = Boolean(originalVideo || context.video);
    const rpcResult = usesVideoRpc
      ? await requireSupabase().rpc('update_post_v2', {
          ...postValuesToRpc(context.values),
          media_items: mediaItems as unknown as Json,
          target_post_id: post.id,
          video_item: buildVideoItem(
            uploadedVideo ?? context.video,
          ) as unknown as Json,
        })
      : await requireSupabase().rpc('update_post', {
          ...postValuesToRpc(context.values),
          media_items: mediaItems as unknown as Json,
          target_post_id: post.id,
        });
    if (rpcResult.error) {
      if (uploadedVideo) {
        const videoToReconcile = uploadedVideo;
        uploadedVideo = null;
        const recovered = await reconcileVideoCommit({
          error: rpcResult.error,
          petId: context.petId,
          postId: post.id,
          uploadedVideo: videoToReconcile,
          userId: context.userId,
        });
        const mediaCleanupPending = await cleanupRemovedPhotos(
          originalMedia,
          mediaItems,
        );
        return { mediaCleanupPending, post: recovered };
      }
      if (usesVideoRpc && uploadedPaths.length > 0) {
        const result = await requireSupabase()
          .from('posts')
          .select('*, post_media(storage_path)')
          .eq('id', post.id)
          .maybeSingle();
        if (result.error) {
          skipPhotoCleanup = true;
          throw new Error('POST_MEDIA_PUBLISH_UNCERTAIN');
        }
        const committedPaths = new Set(
          (result.data?.post_media ?? []).map((item) => item.storage_path),
        );
        if (uploadedPaths.every((path) => committedPaths.has(path))) {
          const { post_media: _media, ...committedPost } = result.data!;
          return {
            mediaCleanupPending: false,
            post: committedPost as Post,
          };
        }
      }
      throw rpcResult.error;
    }

    const mediaCleanupPending = await cleanupRemovedPhotos(
      originalMedia,
      mediaItems,
    );
    return { mediaCleanupPending, post: rpcResult.data };
  } catch (error) {
    if (!skipPhotoCleanup) await cleanupNewPhotoUploads(uploadedPaths);
    if (uploadedVideo) {
      const cleanup = await cleanupUploadedVideo(uploadedVideo, {
        ...context,
        postId: post.id,
      });
      if (cleanup.cleanupPending) {
        throw tagJournalVideoPublishError(
          'cleanup_orphan',
          new Error('POST_VIDEO_CLEANUP_FAILED'),
        );
      }
    }
    throw error;
  }
}
