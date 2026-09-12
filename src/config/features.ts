import { LOCAL_BACKEND } from './backend-target';

// Production gates are constants so public environment variables cannot bypass
// release approval or select a different backend at runtime.
export const PRODUCTION_CHAT_ENABLED = true;
export const PRODUCTION_SCHEDULE_ENABLED = true;
export const LOCAL_FEATURE_PREVIEW = __DEV__ && LOCAL_BACKEND;
export const CHAT_ENABLED = PRODUCTION_CHAT_ENABLED || LOCAL_FEATURE_PREVIEW;
export const SCHEDULE_ENABLED =
  PRODUCTION_SCHEDULE_ENABLED || LOCAL_FEATURE_PREVIEW;
