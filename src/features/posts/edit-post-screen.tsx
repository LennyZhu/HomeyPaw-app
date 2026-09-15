import { type Href, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { spacing } from '@/theme';

import { PostForm } from './components/post-form';
import { existingMediaToDraft, type PostMediaDraft } from './post-media';
import {
  usePost,
  usePostMediaUrls,
  usePostVideoThumbnailUrls,
  useUpdatePost,
} from './post-queries';
import type { PublishProgress } from './post-publishing';
import type { PostFormValues } from './post-schema';
import {
  existingVideoToDraft,
  type PostVideoDraft,
} from './video/post-video-storage';
import { logJournalVideoPublishFailed } from './video/post-video-publish-debug';

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
  const videoThumbnailPath =
    postQuery.data?.post_videos?.thumbnail_path ?? null;
  const videoThumbnailUrlsQuery = usePostVideoThumbnailUrls(
    videoThumbnailPath ? [videoThumbnailPath] : [],
    postQuery.data?.pet_id ?? null,
  );
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPublishUncertain, setIsPublishUncertain] = useState(false);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [hasVideoSubmission, setHasVideoSubmission] = useState(false);
  const localVideoCancel = useRef<(() => void) | null>(null);
  const publishController = useRef<AbortController | null>(null);
  const leaveAfterCancellation = useRef(false);
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
  const initialVideo = useMemo<PostVideoDraft | null>(() => {
    const video = postQuery.data?.post_videos;
    if (!video) return null;
    const thumbnailUrl = videoThumbnailUrlsQuery.data?.[video.thumbnail_path];
    return thumbnailUrl ? existingVideoToDraft(video, thumbnailUrl) : null;
  }, [postQuery.data, videoThumbnailUrlsQuery.data]);

  const handleSubmit = async (
    values: PostFormValues,
    media: PostMediaDraft[],
    video: PostVideoDraft | null,
  ) => {
    const post = postQuery.data;

    if (!post) {
      return;
    }

    setSubmitError(null);
    setIsPublishUncertain(false);
    setProgress(null);
    setHasVideoSubmission(Boolean(video || post.post_videos));
    const controller = new AbortController();
    publishController.current = controller;

    try {
      const result = await updatePost.mutateAsync({
        media,
        onProgress: setProgress,
        originalMedia: post.post_media,
        originalVideo: post.post_videos,
        petId: post.pet_id,
        post,
        signal: controller.signal,
        values,
        video,
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
      if (video || post.post_videos) logJournalVideoPublishFailed(error);
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
              ? t('posts.errors.updateCleanup')
              : t('posts.errors.update'),
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

  if (
    postQuery.isPending ||
    (paths.length > 0 && urlsQuery.isPending) ||
    (videoThumbnailPath && videoThumbnailUrlsQuery.isPending)
  ) {
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

  if (videoThumbnailPath && !initialVideo) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('posts.errors.mediaLoad')}</AppText>
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
          {t('posts.edit.title')}
        </AppText>
      </View>
      <PostForm
        initialMedia={initialMedia}
        initialVideo={initialVideo}
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
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerTitle: { flex: 1 },
});
