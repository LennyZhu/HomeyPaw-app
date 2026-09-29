import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { createProfileAvatarSignedUrls } from '@/features/profile/profile-avatar';
import { requireSupabase } from '@/lib/supabase/client';
import type { Post } from '@/types/database';

import {
  canMarkPostRead,
  isPostReadAccessError,
  markPostReadOnce,
  postReadKeys,
  resolvePostReaderAvatars,
} from './post-read-state';

type ReadablePost = Pick<Post, 'id' | 'pet_id' | 'author_id'>;
export type PostReader = {
  userId: string;
  displayName: string;
  avatarPath: string | null;
  avatarUrl: string | null;
  firstReadAt: string;
};

export function useMarkPostRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useCallback(
    async (post: ReadablePost) => {
      if (
        !canMarkPostRead({
          userId: user?.id,
          postId: post.id,
          authorId: post.author_id,
          ready: true,
          focused: true, // Explicit user click; automatic callers check route focus.
          active: AppState.currentState === 'active',
        })
      )
        return;
      try {
        await markPostReadOnce(
          queryClient,
          { userId: user!.id, postId: post.id, petId: post.pet_id },
          async () => {
            const { data, error } = await requireSupabase().rpc(
              'mark_post_read',
              {
                target_post_id: post.id,
              },
            );
            if (error) throw error;
            // Do not populate identity caches after logout or revoked access.
            await queryClient.invalidateQueries({
              queryKey: postReadKeys.readers(user!.id, post.id, post.pet_id),
            });
            return data;
          },
        );
      } catch (error) {
        if (isPostReadAccessError(error)) {
          queryClient.removeQueries({
            queryKey: postReadKeys.readers(user!.id, post.id, post.pet_id),
          });
        }
        // Non-blocking metadata. Retry only on another view/focus, not render.
      }
    },
    [queryClient, user],
  );
}

export function usePostReadReceipt(
  post: ReadablePost | null | undefined,
  ready: boolean,
) {
  const { user } = useAuth();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const attempted = useRef<string | null>(null);
  const mark = useMarkPostRead();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') attempted.current = null;
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  useFocusEffect(
    useCallback(() => {
      attempted.current = null;
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const key = `${user?.id}:${post?.id}`;
    if (
      post &&
      attempted.current !== key &&
      canMarkPostRead({
        userId: user?.id,
        postId: post.id,
        authorId: post.author_id,
        ready,
        focused,
        active,
      })
    ) {
      attempted.current = key;
      void mark(post);
    }
  }, [active, focused, mark, post, ready, user?.id]);
  return ready && active && focused;
}

export function usePostReaders(
  post: ReadablePost | null | undefined,
  enabled: boolean,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canFetch = Boolean(user && post && enabled);
  const query = useQuery({
    enabled: canFetch,
    queryKey: postReadKeys.readers(
      user?.id,
      post?.id ?? '',
      post?.pet_id ?? '',
    ),
    queryFn: async ({ signal }): Promise<PostReader[]> => {
      const { data, error } = await requireSupabase()
        .rpc('get_post_readers', { target_post_id: post!.id })
        .abortSignal(signal);
      if (error) throw error;
      const signedUrls = await resolvePostReaderAvatars(signal, data, (paths) =>
        createProfileAvatarSignedUrls(queryClient, paths),
      );
      return data.map((reader) => ({
        userId: reader.reader_user_id,
        displayName: reader.reader_display_name,
        avatarPath: reader.reader_avatar_path,
        avatarUrl: reader.reader_avatar_path
          ? (signedUrls[reader.reader_avatar_path] ?? null)
          : null,
        firstReadAt: reader.first_read_at,
      }));
    },
    retry: (count, error) => !isPostReadAccessError(error) && count < 1,
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      if (canFetch) void refetch({ cancelRefetch: false });
    }, [canFetch, refetch]),
  );
  useEffect(() => {
    if (post && user && isPostReadAccessError(query.error)) {
      queryClient.removeQueries({
        queryKey: postReadKeys.readers(user.id, post.id, post.pet_id),
      });
      queryClient.removeQueries({
        queryKey: postReadKeys.mark(user.id, post.id, post.pet_id),
      });
    }
  }, [post, query.error, queryClient, user]);
  return query;
}
