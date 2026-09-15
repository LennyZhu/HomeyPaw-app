import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent, useEventListener } from 'expo';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useId, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { lightColors, spacing } from '@/theme';

import { usePost, usePostVideoUrl } from './post-queries';
import { sanitizeJournalVideoLogText } from './video/post-video-publish-debug';

const sourceLoadTimeoutMs = 20_000;

type SourceBinding = {
  state: 'bound' | 'error';
  url: string;
};

function logViewerError(
  event: string,
  error: unknown,
  details?: Record<string, unknown>,
) {
  if (!__DEV__) return;
  const record =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : null;
  const normalized =
    error instanceof Error
      ? error
      : new Error(
          typeof record?.message === 'string' ? record.message : String(error),
        );
  console.error('[JournalVideo][Viewer]', event, {
    code: sanitizeJournalVideoLogText(record?.code),
    ...details,
    message: sanitizeJournalVideoLogText(normalized.message),
    name: sanitizeJournalVideoLogText(normalized.name),
    stack: sanitizeJournalVideoLogText(normalized.stack),
  });
}

export default function PostVideoViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const postQuery = usePost(id);
  const post = postQuery.data ?? null;
  const video = post?.post_videos ?? null;
  const videoUrl = usePostVideoUrl(
    video?.storage_path ?? null,
    post?.pet_id ?? null,
    Boolean(video),
  );
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
  });
  const status = useEvent(player, 'statusChange', { status: player.status });
  const playback = useEvent(player, 'playingChange', {
    isPlaying: player.playing,
  });
  const playerInstanceId = useId();
  const hasEnded = useRef(false);
  const sourceLoadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceBindAttempt, setSourceBindAttempt] = useState(0);
  const [sourceBinding, setSourceBinding] = useState<SourceBinding | null>(
    null,
  );
  useEventListener(player, 'playToEnd', () => {
    player.pause();
    hasEnded.current = true;
  });
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  useEffect(() => {
    const signedUrl = videoUrl.data;
    if (!signedUrl) return;

    let isCurrentBinding = true;
    hasEnded.current = false;
    if (sourceLoadTimeout.current) {
      clearTimeout(sourceLoadTimeout.current);
    }
    sourceLoadTimeout.current = setTimeout(() => {
      if (!isCurrentBinding) return;
      sourceLoadTimeout.current = null;
      setSourceBinding({ state: 'error', url: signedUrl });
      logViewerError(
        'source_bind_timeout',
        new Error('VIDEO_SOURCE_LOAD_TIMEOUT'),
        { playerInstanceId },
      );
    }, sourceLoadTimeoutMs);

    void player
      .replaceAsync({ uri: signedUrl })
      .then(() => {
        if (!isCurrentBinding) return;
        setSourceBinding({ state: 'bound', url: signedUrl });
      })
      .catch((error: unknown) => {
        if (!isCurrentBinding) return;
        if (sourceLoadTimeout.current) {
          clearTimeout(sourceLoadTimeout.current);
          sourceLoadTimeout.current = null;
        }
        setSourceBinding({ state: 'error', url: signedUrl });
        logViewerError('source_bind_failed', error, { playerInstanceId });
      });

    return () => {
      isCurrentBinding = false;
      if (sourceLoadTimeout.current) {
        clearTimeout(sourceLoadTimeout.current);
        sourceLoadTimeout.current = null;
      }
    };
  }, [player, playerInstanceId, sourceBindAttempt, videoUrl.data]);

  useEffect(() => {
    if (!videoUrl.data) return;
    if (status.status === 'error') {
      if (sourceLoadTimeout.current) {
        clearTimeout(sourceLoadTimeout.current);
        sourceLoadTimeout.current = null;
      }
      logViewerError('playback_error', status.error ?? 'VIDEO_PLAYBACK_ERROR', {
        playerInstanceId,
      });
      return;
    }
    if (status.status === 'readyToPlay') {
      if (sourceLoadTimeout.current) {
        clearTimeout(sourceLoadTimeout.current);
        sourceLoadTimeout.current = null;
      }
    }
  }, [playerInstanceId, status.error, status.status, videoUrl.data]);

  useEffect(() => {
    if (videoUrl.error) {
      logViewerError('signed_url_error', videoUrl.error, {
        playerInstanceId,
      });
    }
  }, [playerInstanceId, videoUrl.error]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') player.pause();
    });
    return () => subscription.remove();
  }, [player]);

  const leaveViewer = () => {
    player.pause();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/journal');
    }
  };

  const saveVideo = async () => {
    if (!video || !videoUrl.data || saveState === 'saving') return;
    setSaveState('saving');
    let downloaded: File | null = null;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true, [
        'video',
      ]);
      if (!permission.granted) throw new Error('VIDEO_SAVE_PERMISSION_DENIED');
      const destination = new File(Paths.cache, `homeypaw-${video.id}.mp4`);
      if (destination.exists) destination.delete();
      const signedUrl =
        Date.now() - videoUrl.dataUpdatedAt >= 540_000
          ? (await videoUrl.refetch()).data
          : videoUrl.data;
      if (!signedUrl) throw new Error('VIDEO_SIGNED_URL_UNAVAILABLE');
      downloaded = await File.downloadFileAsync(signedUrl, destination);
      await MediaLibrary.Asset.create(downloaded.uri);
      setSaveState('saved');
    } catch (error) {
      logViewerError('save_error', error);
      setSaveState('error');
    } finally {
      try {
        if (downloaded?.exists) downloaded.delete();
      } catch {
        // A cache file can be reclaimed by the operating system.
      }
    }
  };

  const togglePlayback = () => {
    if (playback.isPlaying) {
      player.pause();
    } else {
      if (hasEnded.current) {
        player.replay();
        hasEnded.current = false;
      }
      player.play();
    }
  };

  const retryPlayback = async () => {
    try {
      const previousUrl = videoUrl.data;
      setSourceBinding(null);
      const result = await videoUrl.refetch();
      if (!result.data) {
        throw new Error('VIDEO_SIGNED_URL_UNAVAILABLE');
      }
      if (result.data === previousUrl) {
        setSourceBindAttempt((attempt) => attempt + 1);
      }
    } catch (error) {
      if (videoUrl.data) {
        setSourceBinding({ state: 'error', url: videoUrl.data });
      }
      logViewerError('retry_error', error, { playerInstanceId });
    }
  };

  const postUnavailable =
    postQuery.isError || (!postQuery.isPending && (!post || !video));
  const isCurrentSourceBound =
    sourceBinding?.url === videoUrl.data && sourceBinding?.state === 'bound';
  const hasSourceBindingError =
    sourceBinding?.url === videoUrl.data && sourceBinding?.state === 'error';
  const isCurrentSourceReady =
    isCurrentSourceBound && status.status === 'readyToPlay';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.toolbar}>
        <Pressable
          accessibilityLabel={t('posts.video.save')}
          accessibilityRole="button"
          accessibilityState={{ busy: saveState === 'saving' }}
          disabled={!videoUrl.data || saveState === 'saving'}
          onPress={() => void saveVideo()}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          {saveState === 'saving' ? (
            <ActivityIndicator color={lightColors.onPrimary} />
          ) : (
            <Ionicons
              color={lightColors.onPrimary}
              name="download-outline"
              size={24}
            />
          )}
          <AppText tone="onPrimary">{t('posts.video.save')}</AppText>
        </Pressable>
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          onPress={leaveViewer}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Ionicons color={lightColors.onPrimary} name="close" size={32} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {postQuery.isPending && !post ? (
          <View style={styles.state}>
            <ActivityIndicator color={lightColors.onPrimary} />
            <AppText tone="onPrimary">{t('posts.video.loading')}</AppText>
          </View>
        ) : postUnavailable ? (
          <View style={styles.state}>
            <AppText style={styles.centered} tone="onPrimary">
              {t('posts.errors.notFound')}
            </AppText>
            <AppButton
              label={t('common.retry')}
              loading={postQuery.isFetching}
              onPress={() => void postQuery.refetch()}
              variant="secondary"
            />
            <AppButton
              label={t('common.back')}
              onPress={leaveViewer}
              variant="secondary"
            />
          </View>
        ) : videoUrl.isPending ? (
          <View style={styles.state}>
            <ActivityIndicator color={lightColors.onPrimary} />
            <AppText tone="onPrimary">{t('posts.video.loading')}</AppText>
          </View>
        ) : videoUrl.isError ||
          status.status === 'error' ||
          hasSourceBindingError ? (
          <View style={styles.state}>
            <AppText style={styles.centered} tone="onPrimary">
              {t('posts.video.playbackError')}
            </AppText>
            <AppButton
              label={t('common.retry')}
              loading={videoUrl.isFetching}
              onPress={() => void retryPlayback()}
              variant="secondary"
            />
          </View>
        ) : !isCurrentSourceReady ? (
          <View style={styles.state}>
            <ActivityIndicator color={lightColors.onPrimary} />
            <AppText tone="onPrimary">{t('posts.video.loading')}</AppText>
          </View>
        ) : (
          <View style={styles.videoContent}>
            <View style={styles.videoFrame}>
              <VideoView
                contentFit="contain"
                nativeControls={false}
                pointerEvents="none"
                player={player}
                style={styles.video}
              />
              {status.status === 'loading' ? (
                <View style={styles.buffering} pointerEvents="none">
                  <ActivityIndicator color={lightColors.onPrimary} />
                  <AppText tone="onPrimary">
                    {t('posts.video.buffering')}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>
        )}
      </View>

      <View style={styles.playbackControls}>
        <Pressable
          accessibilityLabel={t(
            playback.isPlaying ? 'posts.video.pause' : 'posts.video.play',
          )}
          accessibilityRole="button"
          accessibilityState={{
            disabled:
              !isCurrentSourceReady ||
              videoUrl.isError ||
              status.status === 'error',
          }}
          disabled={
            !isCurrentSourceReady ||
            videoUrl.isError ||
            status.status === 'error'
          }
          onPress={togglePlayback}
          style={({ pressed }) => [
            styles.playbackAction,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            color={lightColors.onPrimary}
            name={playback.isPlaying ? 'pause' : 'play'}
            size={26}
          />
        </Pressable>
      </View>

      {saveState === 'saved' || saveState === 'error' ? (
        <AppText
          accessibilityLiveRegion="polite"
          style={styles.saveStatus}
          tone="onPrimary"
        >
          {t(
            saveState === 'saved'
              ? 'posts.video.saveSuccess'
              : 'posts.video.saveError',
          )}
        </AppText>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
  toolbar: {
    alignItems: 'center',
    flexShrink: 0,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  action: {
    minHeight: 48,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  close: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoContent: { flex: 1, minHeight: 0, width: '100%' },
  videoFrame: { flex: 1, minHeight: 0, width: '100%' },
  video: { flex: 1, width: '100%' },
  playbackControls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    height: 68,
    justifyContent: 'center',
  },
  playbackAction: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  buffering: {
    position: 'absolute',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: lightColors.overlay,
    borderRadius: 12,
    gap: spacing.sm,
    padding: spacing.lg,
    top: '44%',
  },
  state: { alignItems: 'center', gap: spacing.lg, padding: spacing.xl },
  centered: { textAlign: 'center' },
  saveStatus: { padding: spacing.lg, textAlign: 'center' },
  pressed: { opacity: 0.66 },
});
