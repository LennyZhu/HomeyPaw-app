import { LOCAL_BACKEND } from './backend-target';

// Release approval and remote migrations are still pending. Keep the existing
// production lock; a public environment variable cannot bypass it.
export const PRODUCTION_CHAT_ENABLED = false;
export const LOCAL_FEATURE_PREVIEW = __DEV__ && LOCAL_BACKEND;
export const CHAT_ENABLED = PRODUCTION_CHAT_ENABLED || LOCAL_FEATURE_PREVIEW;
export const SCHEDULE_ENABLED = LOCAL_FEATURE_PREVIEW;
