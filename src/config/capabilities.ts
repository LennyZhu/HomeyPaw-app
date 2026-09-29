import { LOCAL_BACKEND } from './backend-target';

export type AppCapabilities = {
  journalVideoCreationEnabled: boolean;
};

export type ServerCapabilities = Partial<AppCapabilities>;

// Journal Video ships in the 1.3.0 release train. This is binary UX availability,
// not authorization; Production/TestFlight/preview must not depend on an env flag.
export const RELEASE_JOURNAL_VIDEO_CREATION_ENABLED = true;

/**
 * Non-DEV bundles use the explicit release capability. DEV keeps local opt-in.
 * ServerCapabilities is a reserved input, not a connected remote kill switch.
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
      (!__DEV__ && RELEASE_JOURNAL_VIDEO_CREATION_ENABLED) ||
      serverCapabilities.journalVideoCreationEnabled === true ||
      localVideoPreview,
  };
}

export const appCapabilities = resolveAppCapabilities();
