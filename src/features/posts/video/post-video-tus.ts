import { File as ExpoFile } from 'expo-file-system';
import SQLiteStorage from 'expo-sqlite/kv-store';
import { defaultOptions, Upload } from 'tus-js-client';

import {
  journalVideoPublishErrorDetails,
  logJournalVideoPublish,
  logJournalVideoPublishError,
  tagJournalVideoPublishError,
} from './post-video-publish-debug';

export const journalVideoTusChunkSize = 6 * 1024 * 1024;
const tusStoragePrefix = 'homeypaw-journal-video-tus::';

type StoredUpload = {
  creationTime: string;
  metadata: Record<string, string>;
  parallelUploadUrls: string[] | null;
  size: number | null;
  uploadUrl: string | null;
  urlStorageKey: string;
};

type ClosableNativeBlob = Blob & { close?: () => void };

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

function loadReactNativeBlob(uri: string) {
  return new Promise<ClosableNativeBlob>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.responseType = 'blob';
    request.onload = () => {
      const blob = request.response as ClosableNativeBlob | null;
      if (!blob || typeof blob.slice !== 'function' || blob.size <= 0) {
        reject(new Error('TUS_REACT_NATIVE_BLOB_INVALID'));
        return;
      }
      resolve(blob);
    };
    request.onerror = () => reject(new Error('TUS_LOCAL_FILE_READ_FAILED'));
    request.open('GET', uri, true);
    request.send();
  });
}

function createReactNativeBlobFileReader(
  onSourceOpened: (close: () => void) => void,
) {
  return {
    async openFile(input: unknown) {
      if (!isReactNativeFile(input)) {
        throw new Error('TUS_REACT_NATIVE_FILE_INVALID');
      }
      const file = new ExpoFile(input.uri);
      if (!file.exists || file.size <= 0) {
        throw new Error('TUS_LOCAL_FILE_UNAVAILABLE');
      }
      const nativeBlob = await loadReactNativeBlob(file.uri);
      const size = nativeBlob.size;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        nativeBlob.close?.();
      };
      onSourceOpened(close);
      return {
        close,
        size,
        async slice(start: number, end: number) {
          return {
            done: end >= size,
            value: nativeBlob.slice(
              start,
              end,
              'application/offset+octet-stream',
            ),
          };
        },
      };
    },
  };
}

function isDeterministicClientFailure(error: Error) {
  return /Creating blobs from|TUS_(?:LOCAL_FILE|REACT_NATIVE)|source object may only|cannot fetch `file\.uri` as Blob/iu.test(
    error.message,
  );
}

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

export function uploadJournalVideoTus({
  accessToken,
  endpoint,
  fileUri,
  objectName,
  onProgress,
  signal,
}: {
  accessToken: string;
  endpoint: string;
  fileUri: string;
  objectName: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}) {
  const file = new ExpoFile(fileUri);
  if (!file.exists || file.size <= 0) {
    const error = new Error('TUS_LOCAL_FILE_UNAVAILABLE');
    logJournalVideoPublishError('upload_video', error, {
      endpoint,
      fileSize: file.exists ? file.size : null,
      storagePath: objectName,
    });
    return Promise.reject(tagJournalVideoPublishError('upload_video', error));
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let closeSource = () => {};
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const upload = new Upload(
      {
        name: file.name,
        size: file.size,
        type: 'video/mp4',
        uri: file.uri,
      } as unknown as Blob,
      {
        chunkSize: journalVideoTusChunkSize,
        endpoint,
        fileReader: createReactNativeBlobFileReader((close) => {
          closeSource = close;
        }),
        fingerprint: () =>
          Promise.resolve(
            [
              'homeypaw-v1',
              endpoint,
              'post-videos',
              objectName,
              file.size,
            ].join('::'),
          ),
        headers: {
          authorization: `Bearer ${accessToken}`,
          'x-upsert': 'false',
        },
        metadata: {
          bucketName: 'post-videos',
          cacheControl: '3600',
          contentType: 'video/mp4',
          objectName,
        },
        onError: (error) =>
          finish(() => {
            closeSource();
            logJournalVideoPublishError('upload_video', error, {
              bucket: 'post-videos',
              endpoint,
              storagePath: objectName,
            });
            reject(tagJournalVideoPublishError('upload_video', error));
          }),
        onProgress: (sent, total) => {
          const progress = total > 0 ? sent / total : 0;
          onProgress?.(progress);
        },
        onShouldRetry: (error, retryAttempt, options) => {
          if (isDeterministicClientFailure(error)) {
            logJournalVideoPublish('upload_video', 'fail_fast', {
              attempt: retryAttempt + 1,
              ...journalVideoPublishErrorDetails(error),
              storagePath: objectName,
            });
            return false;
          }
          const shouldRetry =
            defaultOptions.onShouldRetry?.(error, retryAttempt, options) ??
            false;
          if (shouldRetry) {
            logJournalVideoPublish('upload_video', 'retry', {
              attempt: retryAttempt + 1,
              ...journalVideoPublishErrorDetails(error),
              storagePath: objectName,
            });
          }
          return shouldRetry;
        },
        onSuccess: () =>
          finish(() => {
            resolve();
          }),
        removeFingerprintOnSuccess: true,
        retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
        storeFingerprintForResuming: true,
        uploadDataDuringCreation: true,
        uploadSize: file.size,
        urlStorage: sqliteTusUrlStorage,
      },
    );
    const abort = () => {
      void upload.abort(true).finally(() => {
        closeSource();
        finish(() => reject(new Error('VIDEO_UPLOAD_CANCELLED')));
      });
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    void upload.findPreviousUploads().then(
      (previous) => {
        if (settled || signal?.aborted) return;
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      },
      (error: Error) =>
        finish(() => {
          logJournalVideoPublishError('upload_video', error, {
            operation: 'find_previous_uploads',
            storagePath: objectName,
          });
          reject(tagJournalVideoPublishError('upload_video', error));
        }),
    );
  });
}

export const journalVideoTusFacts = {
  chunkSize: journalVideoTusChunkSize,
  inputUsesBase64: false,
  readsWholeFileIntoJsHeap: false,
  usesNativeBlobSlices: true,
} as const;
