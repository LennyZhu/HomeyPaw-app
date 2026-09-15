export type JournalVideoPublishStage =
  | 'prepare_publish'
  | 'upload_video'
  | 'upload_thumbnail'
  | 'create_post_v2'
  | 'verify_ambiguous_commit'
  | 'cleanup_orphan'
  | 'complete';

type PublishStageError = Error & {
  journalVideoPublishStage?: JournalVideoPublishStage;
};

type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === 'object' ? (value as ErrorRecord) : null;
}

export function sanitizeJournalVideoLogText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(/Bearer\s+[^\s"']+/giu, 'Bearer [redacted]')
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu,
      '[redacted-token]',
    )
    .replace(
      /("?(?:access_token|refresh_token|authorization|apikey)"?\s*[:=]\s*)["']?[^\s,"'}]+/giu,
      '$1[redacted]',
    )
    .replace(
      /([?&](?:token|signature|x-amz-signature)=)[^&\s"']+/giu,
      '$1[redacted]',
    )
    .slice(0, 4_000);
}

function callResponseMethod(response: ErrorRecord | null, method: string) {
  const callback = response?.[method];
  if (typeof callback !== 'function') return undefined;
  try {
    return (callback as () => unknown).call(response);
  } catch {
    return undefined;
  }
}

export function journalVideoPublishErrorDetails(error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const record = asRecord(error);
  const response = asRecord(record?.originalResponse ?? record?.response);
  const responseStatus = callResponseMethod(response, 'getStatus');
  const responseBody = sanitizeJournalVideoLogText(
    callResponseMethod(response, 'getBody'),
  );
  const directStatus = record?.status ?? record?.statusCode;

  return {
    code: sanitizeJournalVideoLogText(record?.code),
    details: sanitizeJournalVideoLogText(record?.details),
    hint: sanitizeJournalVideoLogText(record?.hint),
    message: sanitizeJournalVideoLogText(normalized.message),
    name: sanitizeJournalVideoLogText(normalized.name),
    responseBody,
    stack: sanitizeJournalVideoLogText(normalized.stack),
    status:
      typeof responseStatus === 'number' || typeof responseStatus === 'string'
        ? responseStatus
        : typeof directStatus === 'number' || typeof directStatus === 'string'
          ? directStatus
          : undefined,
  };
}

export function tagJournalVideoPublishError(
  stage: JournalVideoPublishStage,
  error: unknown,
) {
  const source = asRecord(error);
  const normalized: PublishStageError =
    error instanceof Error
      ? error
      : new Error(
          typeof source?.message === 'string' ? source.message : String(error),
        );
  if (!(error instanceof Error) && source) {
    for (const key of ['code', 'details', 'hint', 'status', 'statusCode']) {
      if (source[key] !== undefined) {
        (normalized as unknown as ErrorRecord)[key] = source[key];
      }
    }
  }
  normalized.journalVideoPublishStage = stage;
  return normalized;
}

export function getJournalVideoPublishStage(error: unknown) {
  return error instanceof Error
    ? (error as PublishStageError).journalVideoPublishStage
    : undefined;
}

export function logJournalVideoPublish(
  stage: JournalVideoPublishStage,
  event: string,
  details?: Record<string, unknown>,
) {
  if (!__DEV__) return;
  console.info(`[JournalVideo][Publish][${stage}] ${event}`, details ?? {});
}

export function logJournalVideoPublishError(
  stage: JournalVideoPublishStage,
  error: unknown,
  details?: Record<string, unknown>,
) {
  if (!__DEV__) return;
  console.error(`[JournalVideo][Publish][${stage}] failed`, {
    ...details,
    ...journalVideoPublishErrorDetails(error),
    stage,
  });
}

export function logJournalVideoPublishFailed(error: unknown) {
  if (!__DEV__) return;
  console.error('[JournalVideo][Publish][FAILED]', {
    ...journalVideoPublishErrorDetails(error),
    stage: getJournalVideoPublishStage(error) ?? 'unknown',
  });
}
