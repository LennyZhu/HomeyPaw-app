import { type Href, Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, StyleSheet, View } from 'react-native';
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
import type { PostVideoDraft } from '@/features/posts/video/post-video-storage';
import { logJournalVideoPublishFailed } from '@/features/posts/video/post-video-publish-debug';
import { spacing } from '@/theme';

export default function CreatePostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const petsState = useCurrentPet();
  const createPost = useCreatePost();
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPublishUncertain, setIsPublishUncertain] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [hasVideoSubmission, setHasVideoSubmission] = useState(false);
  const localVideoCancel = useRef<(() => void) | null>(null);
  const publishController = useRef<AbortController | null>(null);
  const leaveAfterCancellation = useRef(false);
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
    video: PostVideoDraft | null,
  ) => {
    if (!petsState.currentPet) return;
    setSubmitError(null);
    setIsPublishUncertain(false);
    setProgress(null);
    setHasVideoSubmission(Boolean(video));
    const controller = new AbortController();
    publishController.current = controller;
    try {
      const post = await createPost.mutateAsync({
        media,
        onProgress: setProgress,
        petId: petsState.currentPet.id,
        signal: controller.signal,
        values,
        video,
      });
      showFeedback(t('posts.create.saved'));
      router.replace(`/posts/${post.id}` as Href);
    } catch (error) {
      if (video) logJournalVideoPublishFailed(error);
      const code = error instanceof Error ? error.message : '';
      setIsPublishUncertain(
        code === 'POST_VIDEO_PUBLISH_UNCERTAIN' ||
          code === 'POST_MEDIA_PUBLISH_UNCERTAIN',
      );
      setSubmitError(
        code === 'VIDEO_UPLOAD_CANCELLED'
          ? t('posts.video.uploadCancelled')
          : code === 'POST_VIDEO_PUBLISH_UNCERTAIN' ||
              code === 'POST_MEDIA_PUBLISH_UNCERTAIN'
            ? t('posts.video.publishUncertain')
            : code === 'POST_MEDIA_CLEANUP_FAILED' ||
                code === 'POST_VIDEO_CLEANUP_FAILED'
              ? t('posts.errors.publishCleanup')
              : t('posts.errors.publish'),
      );
      setProgress(null);
    } finally {
      publishController.current = null;
      setHasVideoSubmission(false);
    }
  };

  const isPublishBusy = hasVideoSubmission;
  const isNavigationBlocked = isProcessingVideo || isPublishBusy;
  const requestLeave = useCallback(() => {
    if (!isNavigationBlocked) {
      router.back();
      return;
    }
    if (progress?.stage === 'saving') {
      Alert.alert(
        t('posts.video.publishInProgressTitle'),
        t('posts.video.publishInProgressBody'),
      );
      return;
    }
    Alert.alert(t('posts.video.cancelTitle'), t('posts.video.cancelBody'), [
      { style: 'cancel', text: t('common.keepEditing') },
      {
        style: 'destructive',
        text: t('posts.video.discard'),
        onPress: () => {
          leaveAfterCancellation.current = true;
          localVideoCancel.current?.();
          publishController.current?.abort();
        },
      },
    ]);
  }, [isNavigationBlocked, progress?.stage, router, t]);

  useEffect(() => {
    if (!isNavigationBlocked) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        requestLeave();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isNavigationBlocked, requestLeave]);

  useEffect(() => {
    if (isNavigationBlocked || !leaveAfterCancellation.current) return;
    leaveAfterCancellation.current = false;
    router.back();
  }, [isNavigationBlocked, router]);

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
      <Stack.Screen options={{ gestureEnabled: !isNavigationBlocked }} />
      <View style={styles.header}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={requestLeave}
        />
        <AppText
          accessibilityRole="header"
          style={styles.headerTitle}
          variant="largeTitle"
        >
          {t('posts.create.title')}
        </AppText>
      </View>
      <PostForm
        initialValues={initialValues}
        onCancelPublish={() => publishController.current?.abort()}
        onLocalVideoProcessingChange={(processing, cancel) => {
          setIsProcessingVideo(processing);
          localVideoCancel.current = cancel;
        }}
        onSubmit={handleSubmit}
        progress={progress}
        submitError={submitError}
        submitDisabled={isPublishUncertain}
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
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerTitle: { flex: 1 },
  emptyContent: {
    gap: spacing.lg,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
});
