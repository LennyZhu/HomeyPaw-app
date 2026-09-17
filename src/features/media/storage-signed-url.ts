import {
  type QueryClient,
  queryOptions,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ImageSource } from 'expo-image';
import { useCallback, useMemo } from 'react';

import { requireSupabase } from '@/lib/supabase/client';

export const storageSignedUrlTtlSeconds = 60 * 60;
export const storageSignedUrlStaleTimeMs = 55 * 60_000;
export const storageSignedUrlGcTimeMs = 6 * 60 * 60_000;

export const storageSignedUrlKeys = {
  all: ['storage-signed-url'] as const,
  bucket: (bucket: string) => [...storageSignedUrlKeys.all, bucket] as const,
  path: (bucket: string, path: string) =>
    [...storageSignedUrlKeys.bucket(bucket), path] as const,
};

async function createStorageSignedUrl(bucket: string, path: string) {
  const { data, error } = await requireSupabase()
    .storage.from(bucket)
    .createSignedUrl(path, storageSignedUrlTtlSeconds);

  if (error || !data.signedUrl) {
    throw error ?? new Error('STORAGE_SIGNED_URL_UNAVAILABLE');
  }

  return data.signedUrl;
}

export function storageSignedUrlQueryOptions(bucket: string, path: string) {
  return queryOptions({
    gcTime: storageSignedUrlGcTimeMs,
    queryFn: () => createStorageSignedUrl(bucket, path),
    queryKey: storageSignedUrlKeys.path(bucket, path),
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: storageSignedUrlStaleTimeMs,
  });
}

export async function getStorageSignedUrls(
  queryClient: QueryClient,
  bucket: string,
  paths: string[],
) {
  const stablePaths = [...new Set(paths.filter(Boolean))].sort();
  const entries = await Promise.all(
    stablePaths.map(
      async (path) =>
        [
          path,
          await queryClient.fetchQuery(
            storageSignedUrlQueryOptions(bucket, path),
          ),
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<string, string>;
}

export function useStorageSignedUrl(bucket: string, path: string | null) {
  return useQuery({
    ...storageSignedUrlQueryOptions(bucket, path ?? ''),
    enabled: Boolean(path),
  });
}

export function useStorageSignedUrls(bucket: string, paths: string[]) {
  const queryClient = useQueryClient();
  const pathKey = [...new Set(paths.filter(Boolean))].sort().join('\u0000');
  const stablePaths = useMemo(
    () => (pathKey ? pathKey.split('\u0000') : []),
    [pathKey],
  );
  const results = useQueries({
    queries: stablePaths.map((path) =>
      storageSignedUrlQueryOptions(bucket, path),
    ),
  });
  const data = useMemo(
    () =>
      Object.fromEntries(
        stablePaths.flatMap((path, index) => {
          const url = results[index]?.data;
          return url ? ([[path, url]] as const) : [];
        }),
      ) as Record<string, string>,
    [results, stablePaths],
  );
  const refetchPath = useCallback(
    async (path: string) => {
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: storageSignedUrlKeys.path(bucket, path),
        refetchType: 'none',
      });
      return queryClient.fetchQuery(storageSignedUrlQueryOptions(bucket, path));
    },
    [bucket, queryClient],
  );

  return {
    data,
    isError: results.some((result) => result.isError),
    isPending:
      stablePaths.length > 0 && results.some((result) => result.isPending),
    refetchPath,
  };
}

export function createStorageImageCacheKey(bucket: string, path: string) {
  return `${bucket}:${path}`;
}

export function createStorageImageSource(
  bucket: string,
  path: string,
  uri: string | null | undefined,
): ImageSource | null {
  return uri
    ? { cacheKey: createStorageImageCacheKey(bucket, path), uri }
    : null;
}
