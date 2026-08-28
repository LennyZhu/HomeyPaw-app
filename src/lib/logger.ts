type LogMetadata = Record<string, unknown>;

const blockedMetadataKey =
  /(authorization|cookie|email|key|password|path|secret|session|token|url|user)/iu;
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gu;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const urlPattern = /https?:\/\/\S+/gu;

function redact(value: string, maximumLength = 240) {
  return value
    .replace(emailPattern, '[redacted-email]')
    .replace(jwtPattern, '[redacted-token]')
    .replace(urlPattern, '[redacted-url]')
    .slice(0, maximumLength);
}

function safeErrorDetails(error: unknown, includeMessage: boolean) {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError' };
  }

  const candidate = error as Error & { code?: unknown; status?: unknown };
  return {
    name: redact(candidate.name || 'Error'),
    ...(includeMessage
      ? { message: redact(candidate.message || 'Unexpected failure') }
      : {}),
    ...(typeof candidate.code === 'string'
      ? { code: redact(candidate.code) }
      : {}),
    ...(typeof candidate.status === 'number'
      ? { status: candidate.status }
      : {}),
  };
}

function safeMetadata(metadata: LogMetadata | undefined) {
  if (!metadata) {
    return undefined;
  }

  const result: Record<string, string | number | boolean> = {};

  Object.entries(metadata).forEach(([key, value]) => {
    if (blockedMetadataKey.test(key)) {
      return;
    }

    if (typeof value === 'string') {
      result[key] = redact(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  });

  return result;
}

export function logError(
  context: string,
  error: unknown,
  metadata?: LogMetadata,
) {
  if (__DEV__) {
    const payload = {
      context: redact(context),
      error: safeErrorDetails(error, true),
      metadata: safeMetadata(metadata),
    };
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(
      '[HomeyPaw]',
      JSON.stringify({
        ...payload,
        ...(stack ? { stack: redact(stack, 3000) } : {}),
      }),
    );
    return;
  }

  // Keep production logging deliberately small and free of stacks, credentials,
  // URLs, emails, user IDs, request payloads, and backend error messages. A crash
  // SDK can replace this adapter later without changing call sites.
  console.error(
    '[HomeyPaw]',
    JSON.stringify({
      context: redact(context),
      error: safeErrorDetails(error, false),
      metadata: safeMetadata(metadata),
    }),
  );
}
