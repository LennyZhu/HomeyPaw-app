import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { VideoPlayer } from 'expo-video';
import { Video, getRealPath, getVideoMetaData } from 'react-native-compressor';

export const journalVideoV0Limits = {
  maxBytes: 25 * 1024 * 1024,
  maxDurationMs: 15_000,
  outputBitrate: 3_000_000,
  outputLongestEdge: 1280,
  thumbnailLongestEdge: 1280,
} as const;

export type PickedVideo = {
  durationMs: number;
  fileName: string | null;
  fileSize: number;
  height: number;
  mimeType: string | null;
  uri: string;
  width: number;
};

export type ProcessedVideo = {
  durationMs: number;
  extension: string;
  fileSize: number;
  height: number;
  processingTimeMs: number;
  uri: string;
  width: number;
};

export type ThumbnailResult = {
  actualTimeSeconds: number | null;
  fileSize: number;
  height: number;
  requestedTimeSeconds: number;
  uri: string;
  width: number;
};

function requireFinitePositive(value: number | null | undefined, code: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(code);
  }
  return value;
}

export async function pickJournalVideoForSpike(): Promise<PickedVideo | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('VIDEO_LIBRARY_PERMISSION_REQUIRED');

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    exif: false,
    mediaTypes: ['videos'],
    quality: 1,
    selectionLimit: 1,
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset || asset.type !== 'video' || !asset.uri) {
    throw new Error('VIDEO_SELECTION_INVALID');
  }

  return {
    durationMs: requireFinitePositive(
      asset.duration,
      'VIDEO_DURATION_UNAVAILABLE',
    ),
    fileName: asset.fileName ?? null,
    fileSize: requireFinitePositive(asset.fileSize, 'VIDEO_SIZE_UNAVAILABLE'),
    height: requireFinitePositive(asset.height, 'VIDEO_HEIGHT_UNAVAILABLE'),
    mimeType: asset.mimeType ?? null,
    uri: asset.uri,
    width: requireFinitePositive(asset.width, 'VIDEO_WIDTH_UNAVAILABLE'),
  };
}

export function validatePickedVideo(video: PickedVideo) {
  if (video.durationMs > journalVideoV0Limits.maxDurationMs) {
    throw new Error('VIDEO_DURATION_LIMIT_EXCEEDED');
  }
}

export async function compressJournalVideoForSpike(
  inputUri: string,
  callbacks: {
    onCancellationId: (id: string) => void;
    onProgress: (progress: number) => void;
  },
): Promise<ProcessedVideo> {
  const localUri = await getRealPath(inputUri, 'video');
  const startedAt = Date.now();
  const uri = await Video.compress(
    localUri,
    {
      bitrate: journalVideoV0Limits.outputBitrate,
      compressionMethod: 'manual',
      getCancellationId: callbacks.onCancellationId,
      maxSize: journalVideoV0Limits.outputLongestEdge,
      minimumFileSizeForCompress: 0,
      progressDivider: 1,
      stripAudio: false,
    },
    callbacks.onProgress,
  );
  const metadata = await getVideoMetaData(uri);
  const result = {
    durationMs: metadata.duration * 1000,
    extension: metadata.extension.toLowerCase(),
    fileSize: metadata.size,
    height: metadata.height,
    processingTimeMs: Date.now() - startedAt,
    uri,
    width: metadata.width,
  };

  if (result.extension !== 'mp4') throw new Error('VIDEO_OUTPUT_NOT_MP4');
  if (result.durationMs > journalVideoV0Limits.maxDurationMs + 250) {
    throw new Error('VIDEO_OUTPUT_DURATION_LIMIT_EXCEEDED');
  }
  if (result.fileSize > journalVideoV0Limits.maxBytes) {
    throw new Error('VIDEO_OUTPUT_SIZE_LIMIT_EXCEEDED');
  }
  if (
    Math.max(result.width, result.height) >
    journalVideoV0Limits.outputLongestEdge
  ) {
    throw new Error('VIDEO_OUTPUT_DIMENSION_LIMIT_EXCEEDED');
  }

  return result;
}

export function cancelJournalVideoCompression(cancellationId: string) {
  Video.cancelCompression(cancellationId);
}

export async function generateJournalVideoThumbnailForSpike(
  player: VideoPlayer,
  durationMs: number,
): Promise<ThumbnailResult> {
  const requestedTimeSeconds = Math.min(1, Math.max(0.5, durationMs / 10_000));
  const [thumbnail] = await player.generateThumbnailsAsync(
    requestedTimeSeconds,
    { maxHeight: 1280, maxWidth: 1280 },
  );
  if (!thumbnail) throw new Error('VIDEO_THUMBNAIL_UNAVAILABLE');

  const context = ImageManipulator.manipulate(thumbnail);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: 0.82,
    format: SaveFormat.JPEG,
  });
  const file = new File(saved.uri);

  return {
    actualTimeSeconds:
      typeof thumbnail.actualTime === 'number' ? thumbnail.actualTime : null,
    fileSize: file.size,
    height: saved.height,
    requestedTimeSeconds,
    uri: saved.uri,
    width: saved.width,
  };
}
