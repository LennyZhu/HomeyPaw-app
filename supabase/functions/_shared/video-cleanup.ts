import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type VideoCleanupReference = {
  storage_path: string;
  thumbnail_path: string;
};

async function removeBucketObjects(
  client: SupabaseClient,
  bucket: 'post-videos' | 'post-video-thumbnails',
  paths: string[],
) {
  const uniquePaths = [...new Set(paths)];

  for (let index = 0; index < uniquePaths.length; index += 100) {
    const batch = uniquePaths.slice(index, index + 100);
    const { error } = await client.storage.from(bucket).remove(batch);

    if (error) {
      const message = `Storage cleanup failed (${error.statusCode ?? 'unknown'}).`;
      await client
        .from('media_cleanup_jobs')
        .update({ last_error: message })
        .eq('bucket_id', bucket)
        .in('storage_path', batch)
        .is('completed_at', null);
      throw error;
    }

    const { error: completionError } = await client
      .from('media_cleanup_jobs')
      .update({ completed_at: new Date().toISOString(), last_error: null })
      .eq('bucket_id', bucket)
      .in('storage_path', batch)
      .is('completed_at', null);

    if (completionError) {
      throw completionError;
    }
  }
}

export async function cleanupVideoReferences(
  client: SupabaseClient,
  references: VideoCleanupReference[],
) {
  if (references.length === 0) {
    return true;
  }

  try {
    await removeBucketObjects(
      client,
      'post-videos',
      references.map((reference) => reference.storage_path),
    );
    await removeBucketObjects(
      client,
      'post-video-thumbnails',
      references.map((reference) => reference.thumbnail_path),
    );
    return true;
  } catch (error) {
    console.error('Journal video cleanup remains queued.', {
      message: error instanceof Error ? error.message : undefined,
    });
    return false;
  }
}
