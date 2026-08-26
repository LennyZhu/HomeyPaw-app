const requestTimeoutMs = 30_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const sourceSignal = init?.signal;
  const forwardAbort = () => controller.abort(sourceSignal?.reason);

  if (sourceSignal?.aborted) {
    forwardAbort();
  } else {
    sourceSignal?.addEventListener('abort', forwardAbort, { once: true });
  }

  const timeout = setTimeout(
    () => controller.abort('PAWDAY_REQUEST_TIMEOUT'),
    requestTimeoutMs,
  );

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    sourceSignal?.removeEventListener('abort', forwardAbort);
  }
}
