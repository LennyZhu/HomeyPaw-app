import { File as ExpoFile } from 'expo-file-system';
import SQLiteStorage from 'expo-sqlite/kv-store';
import { Upload } from 'tus-js-client';

const tusChunkSize = 6 * 1024 * 1024;
const tusStoragePrefix = 'homeypaw-journal-video-tus::';

type StoredUpload = {
  creationTime: string;
  metadata: Record<string, string>;
  parallelUploadUrls: string[] | null;
  size: number | null;
  uploadUrl: string | null;
  urlStorageKey: string;
};

type TusUploadInput = {
  accessToken: string;
  bucketName: string;
  endpoint: string;
  fileUri: string;
  objectName: string;
  onError: (error: Error) => void;
  onProgress: (bytesSent: number, bytesTotal: number) => void;
  onSuccess: (uploadUrl: string | null) => void;
};

function isReactNativeFile(value: unknown): value is {
  name: string;
  size: number;
  type: string;
  uri: string;
} {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.name === 'string' &&
    typeof file.size === 'number' &&
    typeof file.type === 'string' &&
    typeof file.uri === 'string'
  );
}

const expoFileReader = {
  async openFile(input: unknown) {
    if (!isReactNativeFile(input)) {
      throw new Error('TUS_REACT_NATIVE_FILE_INVALID');
    }

    const file = new ExpoFile(input.uri);
    if (!file.exists || file.size <= 0) {
      throw new Error('TUS_LOCAL_FILE_UNAVAILABLE');
    }

    const size = file.size;
    return {
      close() {},
      size,
      async slice(start: number, end: number) {
        return {
          done: end >= size,
          value: file.slice(start, end, input.type),
        };
      },
    };
  },
};

const sqliteTusUrlStorage = {
  async addUpload(fingerprint: string, upload: StoredUpload) {
    const key = `${tusStoragePrefix}${fingerprint}::${Date.now()}`;
    await SQLiteStorage.setItem(key, JSON.stringify(upload));
    return key;
  },
  async findAllUploads() {
    const keys = (await SQLiteStorage.getAllKeys()).filter((key) =>
      key.startsWith(tusStoragePrefix),
    );
    const entries = await SQLiteStorage.multiGet(keys);
    return entries.flatMap(([key, value]) => {
      if (!value) return [];
      try {
        return [{ ...JSON.parse(value), urlStorageKey: key } as StoredUpload];
      } catch {
        return [];
      }
    });
  },
  async findUploadsByFingerprint(fingerprint: string) {
    const prefix = `${tusStoragePrefix}${fingerprint}::`;
    return (await this.findAllUploads()).filter((upload) =>
      upload.urlStorageKey.startsWith(prefix),
    );
  },
  async removeUpload(urlStorageKey: string) {
    await SQLiteStorage.removeItem(urlStorageKey);
  },
};

/**
 * Creates, but does not start, a Supabase-compatible TUS upload.
 * The caller must explicitly resume/start it. The custom reader slices the
 * native Expo File and avoids the default React Native URI-to-whole-Blob step.
 */
export function createJournalVideoTusUpload({
  accessToken,
  bucketName,
  endpoint,
  fileUri,
  objectName,
  onError,
  onProgress,
  onSuccess,
}: TusUploadInput) {
  const file = new ExpoFile(fileUri);
  if (!file.exists || file.size <= 0) {
    throw new Error('TUS_LOCAL_FILE_UNAVAILABLE');
  }

  const reactNativeFile = {
    name: file.name,
    size: file.size,
    type: 'video/mp4',
    uri: file.uri,
  };

  const upload = new Upload(reactNativeFile as unknown as Blob, {
    chunkSize: tusChunkSize,
    endpoint,
    fileReader: expoFileReader,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-upsert': 'false',
    },
    metadata: {
      bucketName,
      cacheControl: '3600',
      contentType: 'video/mp4',
      objectName,
    },
    onError,
    onProgress,
    onSuccess: () => onSuccess(upload.url),
    removeFingerprintOnSuccess: true,
    retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
    storeFingerprintForResuming: true,
    uploadDataDuringCreation: true,
    uploadSize: file.size,
    urlStorage: sqliteTusUrlStorage,
  });

  return {
    abort: (terminate = false) => upload.abort(terminate),
    findPreviousUploads: () => upload.findPreviousUploads(),
    resumeFromPreviousUpload: (
      previous: Awaited<ReturnType<typeof upload.findPreviousUploads>>[number],
    ) => upload.resumeFromPreviousUpload(previous),
    start: () => upload.start(),
  };
}

export const journalVideoTusSpikeFacts = {
  chunkSize: tusChunkSize,
  inputUsesBase64: false,
  readsWholeFileIntoJsHeap: false,
  usesNativeFileSlices: true,
} as const;
