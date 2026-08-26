import { type Href, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { toDateOnly } from '@/features/pets/pet-dates';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { PostForm } from '@/features/posts/components/post-form';
import type { PostMediaDraft } from '@/features/posts/post-media';
import { useCreatePost } from '@/features/posts/post-queries';
import type { PublishProgress } from '@/features/posts/post-publishing';
import type { PostFormValues } from '@/features/posts/post-schema';
import { spacing } from '@/theme';

export default function CreatePostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const petsState = useCurrentPet();
  const createPost = useCreatePost();
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const initialValues = useMemo<PostFormValues>(
    () => ({
      content: '',
      eventDate: toDateOnly(new Date()),
      locationName: '',
      tag: null,
    }),
    [],
  );

  const handleSubmit = async (
    values: PostFormValues,
    media: PostMediaDraft[],
  ) => {
    if (!petsState.currentPet) return;
    setSubmitError(null);
    setProgress(null);
    try {
      const post = await createPost.mutateAsync({
        media,
        onProgress: setProgress,
        petId: petsState.currentPet.id,
        values,
      });
      showFeedback(t('posts.create.saved'));
      router.replace(`/posts/${post.id}` as Href);
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message === 'POST_MEDIA_CLEANUP_FAILED'
          ? t('posts.errors.publishCleanup')
          : t('posts.errors.publish'),
      );
      setProgress(null);
    }
  };

  if (petsState.isPending)
    return <LoadingView label={t('pets.loading.list')} />;
  if (petsState.isError) {
    return (
      <Screen contentContainerStyle={styles.emptyContent}>
        <AppText tone="error">{t('pets.errors.load')}</AppText>
        <AppButton
          label={t('common.retry')}
          onPress={() => void petsState.refetch()}
          variant="secondary"
        />
      </Screen>
    );
  }
  if (!petsState.currentPet) {
    return (
      <Screen contentContainerStyle={styles.emptyContent}>
        <EmptyState
          actionLabel={t('pets.empty.action')}
          body={t('posts.empty.noPetBody')}
          icon="paw-outline"
          onActionPress={() => router.push('/pets/new')}
          title={t('posts.empty.noPetTitle')}
        />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.back()}
        />
        <View style={styles.headerCopy}>
          <AppText accessibilityRole="header" variant="largeTitle">
            {t('posts.create.title')}
          </AppText>
          <AppText
            style={styles.subtitle}
            tone="secondary"
            variant="subheadline"
          >
            {t('posts.create.subtitle', { name: petsState.currentPet.name })}
          </AppText>
        </View>
      </View>
      <PostForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        progress={progress}
        submitError={submitError}
        submitLabel={t('posts.create.submit')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.huge,
  },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  headerCopy: { flex: 1 },
  subtitle: { marginTop: spacing.xs },
  emptyContent: {
    gap: spacing.lg,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
});
