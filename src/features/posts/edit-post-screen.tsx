import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { spacing } from '@/theme';

import { PostForm } from './components/post-form';
import { existingMediaToDraft, type PostMediaDraft } from './post-media';
import { usePost, usePostMediaUrls, useUpdatePost } from './post-queries';
import type { PublishProgress } from './post-publishing';
import type { PostFormValues } from './post-schema';

export default function EditPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const postQuery = usePost(id);
  const updatePost = useUpdatePost();
  const paths = useMemo(
    () => postQuery.data?.post_media.map((item) => item.storage_path) ?? [],
    [postQuery.data],
  );
  const urlsQuery = usePostMediaUrls(paths);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const initialValues = useMemo<PostFormValues | null>(() => {
    if (!postQuery.data) {
      return null;
    }

    return {
      content: postQuery.data.content ?? '',
      eventDate: postQuery.data.event_date,
      locationName: postQuery.data.location_name ?? '',
      tag: postQuery.data.tag,
    };
  }, [postQuery.data]);
  const initialMedia = useMemo<PostMediaDraft[]>(() => {
    if (!postQuery.data || !urlsQuery.data) {
      return [];
    }

    return postQuery.data.post_media.flatMap((media) => {
      const url = urlsQuery.data[media.storage_path];
      return url ? [existingMediaToDraft(media, url)] : [];
    });
  }, [postQuery.data, urlsQuery.data]);

  const handleSubmit = async (
    values: PostFormValues,
    media: PostMediaDraft[],
  ) => {
    const post = postQuery.data;

    if (!post) {
      return;
    }

    setSubmitError(null);
    setProgress(null);

    try {
      const result = await updatePost.mutateAsync({
        media,
        onProgress: setProgress,
        originalMedia: post.post_media,
        petId: post.pet_id,
        post,
        values,
      });

      if (result.mediaCleanupPending) {
        showFeedback(t('posts.errors.removedMediaCleanup'), 'error');
      } else {
        showFeedback(t('posts.edit.saved'));
      }

      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace(`/posts/${post.id}` as Href);
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message === 'POST_MEDIA_CLEANUP_FAILED'
          ? t('posts.errors.updateCleanup')
          : t('posts.errors.update'),
      );
      setProgress(null);
    }
  };

  if (postQuery.isPending || (paths.length > 0 && urlsQuery.isPending)) {
    return <LoadingView label={t('posts.loading.edit')} />;
  }

  if (!postQuery.data || !initialValues) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('posts.errors.notFound')}</AppText>
      </Screen>
    );
  }

  if (postQuery.data.author_id !== user?.id) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('posts.errors.authorOnly')}</AppText>
      </Screen>
    );
  }

  if (paths.length > 0 && initialMedia.length !== paths.length) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('posts.errors.mediaLoad')}</AppText>
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('posts.edit.title')}
      </AppText>
      <AppText style={styles.subtitle} tone="secondary">
        {t('posts.edit.subtitle')}
      </AppText>
      <PostForm
        initialMedia={initialMedia}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        progress={progress}
        submitError={submitError}
        submitLabel={t('common.save')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
  subtitle: {
    marginTop: -spacing.md,
  },
});
