// Phase 10A is intentionally development-only until the database migration and
// release review are approved. The shipped 1.0 production UI cannot enable it.
export const CHAT_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_CHAT_ENABLED === 'true';
