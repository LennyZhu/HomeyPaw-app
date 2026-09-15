import { File } from 'expo-file-system';
import SQLiteStorage from 'expo-sqlite/kv-store';

import { requireSupabase } from '@/lib/supabase/client';
import type { PostVideo } from '@/types/database';

import type { NewPostVideoDraft } from './post-video-pipeline';
import {
  getJournalVideoPublishStage,
  logJournalVideoPublishError,
  tagJournalVideoPublishError,
} from './post-video-publish-debug';
import { uploadJournalVideoTus } from './post-video-tus';

export const postVideoBucket = 'post-videos';
export const postVideoThumbnailBucket = 'post-video-thumbnails';
export const postVideoSignedUrlTtlSeconds = 10 * 60;
const orphanStorageKey = 'homeypaw-journal-video-orphans-v1';

export type ExistingPostVideoDraft = {
  durationMs: number;
  fileSize: number;
  height: number;
  id: string;
  kind: 'existing';
  storagePath: string;
  thumbnailPath: string;
  thumbnailUri: string;
  width: number;
};

export type PostVideoDraft = ExistingPostVideoDraft | NewPostVideoDraft;

export type UploadedPostVideo = {
  duration_ms: number;
  height: number;
  id: string;
  mime_type: 'video/mp4';
  storage_path: string;
  thumbnail_path: string;
  width: number;
};

export type PendingVideoOrphan = {
  bucket: string;
  createdAt: string;
  path: string;
  petId: string;
  postId: string;
  reason: 'cleanup-failed' | 'commit-unknown';
  userId: string;
};

function buildTusEndpoint() {
  const configured = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) throw new Error('SUPABASE_NOT_CONFIGURED');
  const url = new URL(configured);
  const projectRef = url.hostname.endsWith('.supabase.co')
    ? url.hostname.split('.')[0]
    : null;
  return projectRef
    ? `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
    : `${url.origin}/storage/v1/upload/resumable`;
}

async function getAccessToken() {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error || !data.session?.access_token) {
    throw error ?? new Error('AUTHENTICATION_REQUIRED');
  }
  return data.session.access_token;
}

export async function readPendingVideoOrphans(): Promise<PendingVideoOrphan[]> {
  const stored = await SQLiteStorage.getItem(orphanStorageKey);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingVideoOrphan[]) : [];
  } catch {
    return [];
  }
}

export async function recordPendingVideoOrphans(items: PendingVideoOrphan[]) {
  if (items.length === 0) return;
  const current = await readPendingVideoOrphans();
  const deduplicated = new Map(
    [...current, ...items].map((item) => [`${item.bucket}/${item.path}`, item]),
  );
  await SQLiteStorage.setItem(
    orphanStorageKey,
    JSON.stringify([...deduplicated.values()].slice(-100)),
  );
}

export async function uploadPostVideo({
  draft,
  onProgress,
  petId,
  postId,
  signal,
  userId,
}: {
  draft: NewPostVideoDraft;
  onProgress?: (progress: number) => void;
  petId: string;
  postId: string;
  signal?: AbortSignal;
  userId: string;
}): Promise<UploadedPostVideo> {
  const storagePath = `${userId}/${petId}/${postId}/${draft.id}.mp4`;
  const thumbnailPath = `${userId}/${petId}/${postId}/${draft.id}.jpg`;
  const endpoint = buildTusEndpoint();
  try {
    const accessToken = await getAccessToken();
    await uploadJournalVideoTus({
      accessToken,
      endpoint,
      fileUri: draft.uri,
      objectName: storagePath,
      ...(onProgress ? { onProgress } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    const existingStage = getJournalVideoPublishStage(error);
    const tagged = tagJournalVideoPublishError('upload_video', error);
    if (!existingStage) {
      logJournalVideoPublishError('upload_video', tagged, {
        bucket: postVideoBucket,
        endpoint,
        fileSize: draft.fileSize,
        storagePath,
      });
    }
    throw tagged;
  }

  try {
    if (signal?.aborted) throw new Error('VIDEO_UPLOAD_CANCELLED');
    const thumbnail = new File(draft.thumbnail.uri);
    if (!thumbnail.exists || thumbnail.size <= 0) {
      throw new Error('VIDEO_THUMBNAIL_UNAVAILABLE');
    }
    const { error } = await requireSupabase()
      .storage.from(postVideoThumbnailBucket)
      .upload(thumbnailPath, await thumbnail.arrayBuffer(), {
        cacheControl: '3600',
        contentType: 'image/jpeg',
        upsert: false,
      });
    if (error) throw error;
  } catch (error) {
    const tagged = tagJournalVideoPublishError('upload_thumbnail', error);
    logJournalVideoPublishError('upload_thumbnail', tagged, {
      bucket: postVideoThumbnailBucket,
      mimeType: 'image/jpeg',
      storagePath: thumbnailPath,
    });
    const cleanup = await cleanupPostVideoUploads({
      paths: [
        { bucket: postVideoBucket, path: storagePath },
        { bucket: postVideoThumbnailBucket, path: thumbnailPath },
      ],
      petId,
      postId,
      reason: 'cleanup-failed',
      userId,
    });
    if (cleanup.cleanupPending) {
      throw tagJournalVideoPublishError(
        'cleanup_orphan',
        new Error('POST_VIDEO_CLEANUP_FAILED'),
      );
    }
    throw tagged;
  }

  return {
    duration_ms: draft.durationMs,
    height: draft.height,
    id: draft.id,
    mime_type: 'video/mp4',
    storage_path: storagePath,
    thumbnail_path: thumbnailPath,
    width: draft.width,
  };
}

export async function cleanupPostVideoUploads({
  paths,
  petId,
  postId,
  reason,
  userId,
}: {
  paths: { bucket: string; path: string }[];
  petId: string;
  postId: string;
  reason: PendingVideoOrphan['reason'];
  userId: string;
}) {
  const pending: PendingVideoOrphan[] = [];
  for (const item of paths) {
    const cleanupTarget =
      item.bucket === postVideoBucket ? 'video cleanup' : 'thumbnail cleanup';
    try {
      const { error } = await requireSupabase()
        .storage.from(item.bucket)
        .remove([item.path]);
      if (error) throw error;
    } catch (error) {
      logJournalVideoPublishError('cleanup_orphan', error, {
        bucket: item.bucket,
        cleanupTarget,
        storagePath: item.path,
      });
      pending.push({
        ...item,
        createdAt: new Date().toISOString(),
        petId,
        postId,
        reason,
        userId,
      });
    }
  }
  try {
    await recordPendingVideoOrphans(pending);
  } catch {
    // The structured cleanup result still reaches the UI if local persistence
    // is temporarily unavailable.
  }
  return { cleanupPending: pending.length > 0 };
}

export function getUploadedVideoPaths(video: UploadedPostVideo) {
  return [
    { bucket: postVideoBucket, path: video.storage_path },
    { bucket: postVideoThumbnailBucket, path: video.thumbnail_path },
  ];
}

export async function createPostVideoThumbnailSignedUrls(paths: string[]) {
  if (paths.length === 0) return {} as Record<string, string>;
  const { data, error } = await requireSupabase()
    .storage.from(postVideoThumbnailBucket)
    .createSignedUrls(paths, 3600);
  if (error) throw error;
  return Object.fromEntries(
    data.flatMap((item, index) => {
      const path = paths[index];
      return path && item.signedUrl ? [[path, item.signedUrl]] : [];
    }),
  );
}

export async function createPostVideoSignedUrl(path: string) {
  const { data, error } = await requireSupabase()
    .storage.from(postVideoBucket)
    .createSignedUrl(path, postVideoSignedUrlTtlSeconds);
  if (error || !data.signedUrl) {
    throw error ?? new Error('VIDEO_SIGNED_URL_UNAVAILABLE');
  }
  return data.signedUrl;
}

export function existingVideoToDraft(
  video: PostVideo,
  thumbnailUri: string,
): ExistingPostVideoDraft {
  return {
    durationMs: video.duration_ms,
    fileSize: video.file_size_bytes,
    height: video.height,
    id: video.id,
    kind: 'existing',
    storagePath: video.storage_path,
    thumbnailPath: video.thumbnail_path,
    thumbnailUri,
    width: video.width,
  };
}

export function videoDraftThumbnailUri(video: PostVideoDraft) {
  return video.kind === 'new' ? video.thumbnail.uri : video.thumbnailUri;
}
