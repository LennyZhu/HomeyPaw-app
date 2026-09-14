import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';
import { lightColors, radius, spacing } from '@/theme';
import { journalVideoTusSpikeFacts } from '../../../spikes/journal-video-v0/tus-upload';
import {
  cancelJournalVideoCompression,
  compressJournalVideoForSpike,
  generateJournalVideoThumbnailForSpike,
  pickJournalVideoForSpike,
  validatePickedVideo,
  type PickedVideo,
  type ProcessedVideo,
  type ThumbnailResult,
} from '../../../spikes/journal-video-v0/video-pipeline';

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function JournalVideoSpikeRoute() {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [processed, setProcessed] = useState<ProcessedVideo | null>(null);
  const [thumbnail, setThumbnail] = useState<ThumbnailResult | null>(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Ready');
  const [playerFacts, setPlayerFacts] = useState<unknown>(null);
  const [cancellationId, setCancellationId] = useState<string | null>(null);
  const videoView = useRef<VideoView>(null);
  const player = useVideoPlayer(null, (createdPlayer) => {
    createdPlayer.loop = false;
    createdPlayer.staysActiveInBackground = false;
  });

  useEffect(() => {
    const onAppStateChange = (state: AppStateStatus) => {
      if (state !== 'active') player.pause();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => {
      player.pause();
      subscription.remove();
    };
  }, [player]);

  if (!__DEV__) return <Redirect href="/" />;

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'UNKNOWN_ERROR');
    } finally {
      setBusy(false);
    }
  };

  const selectVideo = () =>
    run(async () => {
      const video = await pickJournalVideoForSpike();
      if (!video) {
        setMessage('Selection canceled');
        return;
      }
      validatePickedVideo(video);
      setPicked(video);
      setProcessed(null);
      setThumbnail(null);
      setProgress(0);
      await player.replaceAsync({ uri: video.uri, useCaching: false });
      setMessage('Video selected and loaded locally');
    });

  const compressVideo = () =>
    run(async () => {
      if (!picked) throw new Error('SELECT_VIDEO_FIRST');
      setProgress(0);
      try {
        const result = await compressJournalVideoForSpike(picked.uri, {
          onCancellationId: setCancellationId,
          onProgress: setProgress,
        });
        setProcessed(result);
        await player.replaceAsync({ uri: result.uri, useCaching: false });
        setMessage('Compression complete; output loaded');
      } finally {
        setCancellationId(null);
      }
    });

  const generateThumbnail = () =>
    run(async () => {
      const durationMs = processed?.durationMs ?? picked?.durationMs;
      if (!durationMs) throw new Error('LOAD_VIDEO_FIRST');
      const result = await generateJournalVideoThumbnailForSpike(
        player,
        durationMs,
      );
      setThumbnail(result);
      setMessage('Thumbnail generated from current local video');
    });

  const inspectPlayer = () => {
    setPlayerFacts({
      audioTrackCount: player.availableAudioTracks.length,
      durationSeconds: player.duration,
      status: player.status,
      videoTrack: player.videoTrack
        ? {
            averageBitrate: player.videoTrack.averageBitrate,
            frameRate: player.videoTrack.frameRate,
            mimeType: player.videoTrack.mimeType,
            size: player.videoTrack.size,
            videoRange: player.videoTrack.videoRange,
          }
        : null,
    });
  };

  const saveProcessedVideo = () =>
    run(async () => {
      if (!processed) throw new Error('COMPRESS_VIDEO_FIRST');
      const permission = await requestPermissionsAsync(true, ['video']);
      if (!permission.granted)
        throw new Error('VIDEO_SAVE_PERMISSION_REQUIRED');
      await Asset.create(processed.uri);
      setMessage('Compressed video saved to Photos');
    });

  return (
    <Screen
      contentContainerStyle={styles.content}
      contentWidth="schedule"
      scroll
    >
      <AppText variant="title1">Journal Video V0 Spike</AppText>
      <AppText tone="secondary">
        Dev-only route. It is not linked from product navigation and performs no
        upload.
      </AppText>

      <AppButton
        disabled={busy}
        label="Select ≤15s library video"
        onPress={selectVideo}
      />
      {picked ? (
        <AppText variant="caption">{prettyJson(picked)}</AppText>
      ) : null}

      <View style={styles.row}>
        <AppButton
          disabled={busy || !picked}
          label="Compress to 1280px MP4"
          onPress={compressVideo}
          style={styles.flexButton}
        />
        <AppButton
          disabled={!cancellationId}
          label="Cancel"
          onPress={() => {
            if (cancellationId) {
              cancelJournalVideoCompression(cancellationId);
            }
          }}
          style={styles.flexButton}
          variant="secondary"
        />
      </View>
      <AppText tone="secondary">
        Compression progress: {Math.round(progress * 100)}%
      </AppText>
      {processed ? (
        <AppText variant="caption">{prettyJson(processed)}</AppText>
      ) : null}
      <AppButton
        disabled={busy || !processed}
        label="Save compressed video to Photos"
        onPress={saveProcessedVideo}
        variant="secondary"
      />

      <VideoView
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        player={player}
        ref={videoView}
        style={styles.video}
      />
      <View style={styles.row}>
        <AppButton
          label="Fullscreen"
          onPress={() => void videoView.current?.enterFullscreen()}
          style={styles.flexButton}
          variant="secondary"
        />
        <AppButton
          label="Inspect player"
          onPress={inspectPlayer}
          style={styles.flexButton}
          variant="secondary"
        />
      </View>
      {playerFacts ? (
        <AppText variant="caption">{prettyJson(playerFacts)}</AppText>
      ) : null}

      <AppButton
        disabled={busy || (!picked && !processed)}
        label="Generate 0.5–1s JPEG thumbnail"
        onPress={generateThumbnail}
        variant="secondary"
      />
      {thumbnail ? (
        <View style={styles.thumbnailCard}>
          <Image
            contentFit="contain"
            source={thumbnail.uri}
            style={styles.thumbnail}
          />
          <AppText variant="caption">{prettyJson(thumbnail)}</AppText>
        </View>
      ) : null}

      <AppText variant="headline">Optional remote/signed URL playback</AppText>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setRemoteUrl}
        placeholder="Paste a non-Production test URL"
        style={styles.input}
        value={remoteUrl}
      />
      <AppButton
        disabled={busy || remoteUrl.trim().length === 0}
        label="Load remote URL"
        onPress={() =>
          void run(async () => {
            await player.replaceAsync({
              contentType: 'progressive',
              uri: remoteUrl.trim(),
              useCaching: false,
            });
            setMessage('Remote URL loaded');
          })
        }
      />
      <AppText variant="headline">TUS code-level result</AppText>
      <AppText variant="caption">
        {prettyJson(journalVideoTusSpikeFacts)}
      </AppText>
      <AppText tone="brand">{message}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.md },
  flexButton: { flex: 1 },
  input: {
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    color: lightColors.textPrimary,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  thumbnail: { aspectRatio: 16 / 9, width: '100%' },
  thumbnailCard: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.md,
    gap: spacing.sm,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  video: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    borderRadius: radius.md,
    overflow: 'hidden',
    width: '100%',
  },
});
