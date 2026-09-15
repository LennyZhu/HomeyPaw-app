import { LOCAL_BACKEND } from './backend-target';

export type AppCapabilities = {
  journalVideoCreationEnabled: boolean;
};

export type ServerCapabilities = Partial<AppCapabilities>;

/**
 * Keeps rollout policy separate from the UI. A future authenticated server
 * capability can enable creation after reader-capable clients are deployed.
 * The local environment override is deliberately rejected for remote backends.
 */
export function resolveAppCapabilities(
  serverCapabilities: ServerCapabilities = {},
): AppCapabilities {
  const localVideoPreview =
    LOCAL_BACKEND &&
    process.env.EXPO_PUBLIC_JOURNAL_VIDEO_CREATION_ENABLED === 'true';

  return {
    journalVideoCreationEnabled:
      serverCapabilities.journalVideoCreationEnabled === true ||
      localVideoPreview,
  };
}

export const appCapabilities = resolveAppCapabilities();
