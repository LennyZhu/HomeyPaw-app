import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { familyKeys } from '@/features/family/family-queries';
import { toDateOnly } from '@/features/pets/pet-dates';
import { requireSupabase } from '@/lib/supabase/client';
import type { Post, PostMedia } from '@/types/database';

import { createPostMediaSignedUrls } from './post-media';
import {
  publishPost,
  savePostEdit,
  type PublishProgress,
} from './post-publishing';
import type { PostFormValues } from './post-schema';
import type { PostMediaDraft } from './post-media';

export type PostWithMedia = Post & { post_media: PostMedia[] };
export type PetMemory = {
  kind: 'on_this_day' | 'recent';
  postId: string;
  yearsAgo: number | null;
};

type PostCursor = Pick<Post, 'created_at' | 'event_date' | 'id'>;
type PostPage = {
  nextCursor: PostCursor | null;
  posts: PostWithMedia[];
};

const postPageSize = 10;

export const postKeys = {
  all: (userId: string | undefined) => ['posts', userId] as const,
  detail: (userId: string | undefined, postId: string) =>
    ['posts', userId, 'detail', postId] as const,
  list: (userId: string | undefined, petId: string | null) =>
    ['posts', userId, 'list', petId] as const,
  memory: (
    userId: string | undefined,
    petId: string | null,
    localToday: string,
  ) => ['posts', userId, 'memory', petId, localToday] as const,
  mediaUrls: (userId: string | undefined, paths: string[]) =>
    ['posts', userId, 'media-urls', ...paths] as const,
};

async function fetchPetMemory(
  petId: string,
  localToday: string,
): Promise<PetMemory | null> {
  const { data, error } = await requireSupabase().rpc('get_pet_memory', {
    local_today: localToday,
    target_pet_id: petId,
  });

  if (error) {
    throw error;
  }

  const memory = data[0];
  return memory
    ? {
        kind: memory.memory_kind,
        postId: memory.memory_post_id,
        yearsAgo: memory.memory_years_ago,
      }
    : null;
}

async function fetchPostPage(
  petId: string,
  cursor: PostCursor | null,
): Promise<PostPage> {
  let query = requireSupabase()
    .from('posts')
    .select('*, post_media(*)')
    .eq('pet_id', petId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .order('position', { ascending: true, referencedTable: 'post_media' })
    .limit(postPageSize + 1);

  if (cursor) {
    query = query.or(
      `event_date.lt.${cursor.event_date},and(event_date.eq.${cursor.event_date},created_at.lt.${cursor.created_at}),and(event_date.eq.${cursor.event_date},created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const hasNextPage = data.length > postPageSize;
  const posts = data.slice(0, postPageSize) as PostWithMedia[];
  const lastPost = posts.at(-1);

  return {
    nextCursor:
      hasNextPage && lastPost
        ? {
            created_at: lastPost.created_at,
            event_date: lastPost.event_date,
            id: lastPost.id,
          }
        : null,
    posts,
  };
}

async function fetchPost(postId: string) {
  const { data, error } = await requireSupabase()
    .from('posts')
    .select('*, post_media(*)')
    .eq('id', postId)
    .order('position', { ascending: true, referencedTable: 'post_media' })
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as PostWithMedia | null;
}

async function deletePost(postId: string) {
  const { data, error } = await requireSupabase().functions.invoke<{
    deleted: boolean;
  }>('delete-post', { body: { postId } });

  if (error || !data?.deleted) {
    throw error ?? new Error('POST_DELETE_FAILED');
  }

  return data;
}

export function usePosts(petId: string | null) {
  const { user } = useAuth();

  return useInfiniteQuery<
    PostPage,
    Error,
    InfiniteData<PostPage>,
    ReturnType<typeof postKeys.list>,
    PostCursor | null
  >({
    enabled: Boolean(user && petId),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as PostCursor | null,
    queryFn: ({ pageParam }) => fetchPostPage(petId!, pageParam),
    queryKey: postKeys.list(user?.id, petId),
  });
}

export function usePetMemory(petId: string | null, today = new Date()) {
  const { user } = useAuth();
  const localToday = toDateOnly(today);

  return useQuery({
    enabled: Boolean(user && petId),
    queryFn: () => fetchPetMemory(petId!, localToday),
    queryKey: postKeys.memory(user?.id, petId, localToday),
  });
}

export function usePost(postId: string) {
  const { user } = useAuth();

  return useQuery({
    enabled: Boolean(user && postId),
    queryFn: () => fetchPost(postId),
    queryKey: postKeys.detail(user?.id, postId),
  });
}

export function usePostMediaUrls(storagePaths: string[]) {
  const { user } = useAuth();
  const stablePaths = [...new Set(storagePaths)].sort();

  return useQuery({
    enabled: Boolean(user && stablePaths.length > 0),
    gcTime: 3_600_000,
    queryFn: () => createPostMediaSignedUrls(stablePaths),
    queryKey: postKeys.mediaUrls(user?.id, stablePaths),
    staleTime: 3_000_000,
  });
}

type CreatePostInput = {
  media: PostMediaDraft[];
  petId: string;
  values: PostFormValues;
  onProgress?: (progress: PublishProgress) => void;
};

export function useCreatePost() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePostInput) => {
      if (!user) {
        throw new Error('AUTHENTICATION_REQUIRED');
      }

      return publishPost({ ...input, userId: user.id });
    },
    onSuccess: (post) => {
      void queryClient.invalidateQueries({
        queryKey: postKeys.list(user?.id, post.pet_id),
      });
      void queryClient.invalidateQueries({
        queryKey: familyKeys.postAuthors(user?.id, post.pet_id),
      });
      void queryClient.invalidateQueries({
        queryKey: ['posts', user?.id, 'memory', post.pet_id],
      });
      queryClient.setQueryData(postKeys.detail(user?.id, post.id), undefined);
    },
  });
}

type UpdatePostInput = CreatePostInput & {
  originalMedia: PostMedia[];
  post: Post;
};

export function useUpdatePost() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdatePostInput) => {
      if (!user) {
        throw new Error('AUTHENTICATION_REQUIRED');
      }

      return savePostEdit({ ...input, userId: user.id });
    },
    onSuccess: ({ post }) => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: postKeys.list(user?.id, post.pet_id),
        }),
        queryClient.invalidateQueries({
          queryKey: postKeys.detail(user?.id, post.id),
        }),
        queryClient.invalidateQueries({
          queryKey: ['posts', user?.id, 'memory', post.pet_id],
        }),
      ]);
    },
  });
}

export function useDeletePost() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePost,
    onSuccess: (_data, postId) => {
      const cachedPost = queryClient.getQueryData<PostWithMedia | null>(
        postKeys.detail(user?.id, postId),
      );
      queryClient.removeQueries({
        queryKey: postKeys.detail(user?.id, postId),
      });
      void queryClient.invalidateQueries({
        queryKey: postKeys.all(user?.id),
      });
      if (cachedPost) {
        void queryClient.invalidateQueries({
          queryKey: familyKeys.postAuthors(user?.id, cachedPost.pet_id),
        });
      }
    },
  });
}
