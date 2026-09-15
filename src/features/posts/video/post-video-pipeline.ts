import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { createVideoPlayer } from 'expo-video';
import { Video, getRealPath, getVideoMetaData } from 'react-native-compressor';

export const journalVideoLimits = {
  maxOutputBytes: 25 * 1024 * 1024,
  maxDurationMs: 15_000,
  outputBitrate: 3_000_000,
  outputLongestEdge: 1280,
  thumbnailLongestEdge: 1280,
  thumbnailMaxBytes: 2 * 1024 * 1024,
} as const;

export type PickedJournalVideo = {
  durationMs: number;
  fileName: string | null;
  fileSize: number;
  height: number;
  mimeType: string | null;
  uri: string;
  width: number;
};

export type ProcessedJournalVideo = {
  durationMs: number;
  fileSize: number;
  height: number;
  processingTimeMs: number;
  uri: string;
  width: number;
};

export type JournalVideoThumbnail = {
  fileSize: number;
  height: number;
  uri: string;
  width: number;
};

export type NewPostVideoDraft = ProcessedJournalVideo & {
  id: string;
  kind: 'new';
  thumbnail: JournalVideoThumbnail;
};

export type JournalVideoPipelineStage =
  | 'picker'
  | 'resolve_source'
  | 'compress'
  | 'validate_output'
  | 'generate_thumbnail'
  | 'prepare_upload';

type JournalVideoStageError = Error & {
  journalVideoStage?: JournalVideoPipelineStage;
};

function debugStageError(
  stage: JournalVideoPipelineStage,
  error: unknown,
  details?: Record<string, unknown>,
) {
  if (!__DEV__) return;
  const normalized = error instanceof Error ? error : new Error(String(error));
  console.error(`[JournalVideo][${stage}] failed`, {
    ...details,
    message: normalized.message,
    name: normalized.name,
    nativeError: error,
    stack: normalized.stack,
    stage,
  });
}

function taggedError(stage: JournalVideoPipelineStage, error: unknown) {
  const normalized: JournalVideoStageError =
    error instanceof Error ? error : new Error(String(error));
  normalized.journalVideoStage = stage;
  return normalized;
}

function failStage(
  stage: JournalVideoPipelineStage,
  error: unknown,
  details?: Record<string, unknown>,
): never {
  debugStageError(stage, error, details);
  throw taggedError(stage, error);
}

export function getJournalVideoFailureStage(error: unknown) {
  return error instanceof Error
    ? (error as JournalVideoStageError).journalVideoStage
    : undefined;
}

export function logJournalVideoComposerError(
  error: unknown,
  fallbackStage: JournalVideoPipelineStage,
) {
  if (!__DEV__) return;
  const normalized = error instanceof Error ? error : new Error(String(error));
  console.error('[JournalVideo][Composer]', {
    message: normalized.message,
    name: normalized.name,
    nativeError: error,
    stack: normalized.stack,
    stage: getJournalVideoFailureStage(error) ?? fallbackStage,
  });
}

function requirePositive(value: number | null | undefined, code: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(code);
  }
  return value;
}

async function requireVideoLibraryPermission() {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return;
  const result = current.canAskAgain
    ? await ImagePicker.requestMediaLibraryPermissionsAsync()
    : current;
  if (!result.granted) throw new Error('VIDEO_LIBRARY_PERMISSION_REQUIRED');
}

export async function pickJournalVideo(): Promise<PickedJournalVideo | null> {
  try {
    await requireVideoLibraryPermission();
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

    const picked = {
      durationMs: requirePositive(asset.duration, 'VIDEO_DURATION_UNAVAILABLE'),
      fileName: asset.fileName ?? null,
      fileSize: requirePositive(asset.fileSize, 'VIDEO_SIZE_UNAVAILABLE'),
      height: requirePositive(asset.height, 'VIDEO_HEIGHT_UNAVAILABLE'),
      mimeType: asset.mimeType ?? null,
      uri: asset.uri,
      width: requirePositive(asset.width, 'VIDEO_WIDTH_UNAVAILABLE'),
    };
    validatePickedJournalVideo(picked);
    return picked;
  } catch (error) {
    return failStage('picker', error);
  }
}

export function validatePickedJournalVideo(video: PickedJournalVideo) {
  if (video.durationMs > journalVideoLimits.maxDurationMs) {
    throw new Error('VIDEO_DURATION_LIMIT_EXCEEDED');
  }
}

export async function compressJournalVideo(
  inputUri: string,
  callbacks: {
    onCancellationId: (id: string) => void;
    onProgress: (progress: number) => void;
  },
): Promise<ProcessedJournalVideo> {
  let localUri: string;
  try {
    localUri = await getRealPath(inputUri, 'video');
  } catch (error) {
    return failStage('resolve_source', error, {
      getRealPathCalled: true,
      originalPickerUri: inputUri,
    });
  }

  const startedAt = Date.now();
  let uri: string;
  try {
    uri = await Video.compress(
      localUri,
      {
        bitrate: journalVideoLimits.outputBitrate,
        compressionMethod: 'manual',
        getCancellationId: callbacks.onCancellationId,
        maxSize: journalVideoLimits.outputLongestEdge,
        minimumFileSizeForCompress: 0,
        progressDivider: 1,
        stripAudio: false,
      },
      (progress) => {
        callbacks.onProgress(progress);
      },
    );
  } catch (error) {
    return failStage('compress', error, { compressorInput: localUri });
  }

  let metadata: Awaited<ReturnType<typeof getVideoMetaData>>;
  try {
    metadata = await getVideoMetaData(uri);
  } catch (error) {
    let outputFileExists: boolean | null = null;
    try {
      outputFileExists = new File(uri).exists;
    } catch {}
    return failStage('validate_output', error, {
      outputFileExists,
      outputUri: uri,
      reason: outputFileExists === false ? 'file_missing' : 'metadata_failed',
    });
  }
  const result: ProcessedJournalVideo = {
    durationMs: Math.round(metadata.duration * 1000),
    fileSize: metadata.size,
    height: metadata.height,
    processingTimeMs: Date.now() - startedAt,
    uri,
    width: metadata.width,
  };
  const rejectOutput = (code: string, reason: string): never => {
    const error = taggedError('validate_output', new Error(code));
    debugStageError('validate_output', error, {
      durationMs: result.durationMs,
      extension: metadata.extension,
      fileSize: result.fileSize,
      height: result.height,
      outputUri: uri,
      reason,
      width: result.width,
    });
    removeJournalVideoLocalFiles([uri]);
    throw error;
  };

  if (metadata.extension.toLowerCase() !== 'mp4') {
    return rejectOutput('VIDEO_OUTPUT_NOT_MP4', 'mime_invalid');
  }
  if (result.durationMs > journalVideoLimits.maxDurationMs) {
    return rejectOutput(
      'VIDEO_OUTPUT_DURATION_LIMIT_EXCEEDED',
      'duration_invalid',
    );
  }
  if (result.fileSize > journalVideoLimits.maxOutputBytes) {
    return rejectOutput('VIDEO_OUTPUT_SIZE_LIMIT_EXCEEDED', 'size_invalid');
  }
  if (
    Math.max(result.width, result.height) > journalVideoLimits.outputLongestEdge
  ) {
    return rejectOutput(
      'VIDEO_OUTPUT_DIMENSION_LIMIT_EXCEEDED',
      'dimension_invalid',
    );
  }
  return result;
}

export function cancelJournalVideoCompression(cancellationId: string) {
  Video.cancelCompression(cancellationId);
}

export async function generateJournalVideoThumbnail(
  video: ProcessedJournalVideo,
): Promise<JournalVideoThumbnail> {
  const player = createVideoPlayer(null);
  try {
    await player.replaceAsync({ uri: video.uri });
    const requestedTimeSeconds = Math.min(
      1,
      Math.max(0.5, video.durationMs / 10_000),
    );
    const [thumbnail] = await player.generateThumbnailsAsync(
      requestedTimeSeconds,
      { maxHeight: 1280, maxWidth: 1280 },
    );
    if (!thumbnail) throw new Error('VIDEO_THUMBNAIL_UNAVAILABLE');
    const rendered = await ImageManipulator.manipulate(thumbnail).renderAsync();
    const saved = await rendered.saveAsync({
      compress: 0.82,
      format: SaveFormat.JPEG,
    });
    const file = new File(saved.uri);
    if (!file.exists || file.size <= 0) {
      throw new Error('VIDEO_THUMBNAIL_UNAVAILABLE');
    }
    if (file.size > journalVideoLimits.thumbnailMaxBytes) {
      file.delete();
      throw new Error('VIDEO_THUMBNAIL_SIZE_LIMIT_EXCEEDED');
    }
    const result = {
      fileSize: file.size,
      height: saved.height,
      uri: saved.uri,
      width: saved.width,
    };
    return result;
  } catch (error) {
    return failStage('generate_thumbnail', error, {
      sourceVideoUri: video.uri,
    });
  } finally {
    player.release();
  }
}

export function removeJournalVideoTempFiles(
  draft: NewPostVideoDraft | null | undefined,
) {
  if (!draft) return;
  removeJournalVideoLocalFiles([draft.uri, draft.thumbnail.uri]);
}

export function removeJournalVideoLocalFiles(uris: string[]) {
  for (const uri of new Set(uris)) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Temporary file cleanup is best-effort and never blocks navigation.
    }
  }
}
