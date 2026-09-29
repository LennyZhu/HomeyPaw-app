import type { QueryClient } from '@tanstack/react-query';

export const postReadKeys = {
  mark: (userId: string, postId: string, petId: string) =>
    ['post-read', userId, postId, petId] as const,
  readers: (userId: string | undefined, postId: string, petId: string) =>
    ['post-readers', userId, postId, petId] as const,
};

export function canMarkPostRead(input: {
  userId: string | undefined;
  postId: string | undefined;
  authorId: string | null | undefined;
  ready: boolean;
  focused: boolean;
  active: boolean;
}) {
  return Boolean(
    input.userId &&
    input.postId &&
    input.authorId !== input.userId &&
    input.ready &&
    input.focused &&
    input.active,
  );
}

// QueryClient owns the session: logout/session replacement and revoked access
// clear these keys. Concurrent Detail/media calls share one pending request.
export function markPostReadOnce(
  queryClient: QueryClient,
  input: { userId: string; postId: string; petId: string },
  mark: () => Promise<string>,
) {
  return queryClient.fetchQuery({
    queryKey: postReadKeys.mark(input.userId, input.postId, input.petId),
    queryFn: mark,
    gcTime: Infinity,
    staleTime: Infinity,
    retry: false,
    networkMode: 'always',
  });
}

export function isPostReadAccessError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '42501',
  );
}

export async function resolvePostReaderAvatars(
  signal: AbortSignal,
  readers: { reader_avatar_path: string | null }[],
  sign: (paths: string[]) => Promise<Record<string, string>>,
) {
  // A late RPC response must not start new storage queries after cache cleanup.
  if (signal.aborted) throw new Error('Post readers request canceled');
  const paths = readers.flatMap((reader) =>
    reader.reader_avatar_path ? [reader.reader_avatar_path] : [],
  );
  const signedUrls = await sign(paths).catch(
    () => ({}) as Record<string, string>,
  );
  if (signal.aborted) throw new Error('Post readers request canceled');
  return signedUrls;
}
