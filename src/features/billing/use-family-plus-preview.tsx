import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentFamilyStore } from '@/stores/current-family-store';
import {
  familyPlusIdentity,
  type FamilyPlusRole,
} from './family-plus-presentation';
import {
  canUseFamilyPlusPreview,
  familyPlusPreviewMemory,
  familyPlusPreviewSnapshot,
  type FamilyPlusPreviewScene,
} from './family-plus-preview';

const disabledState = {
  scope: null,
  scene: 'unavailable' as const,
  generation: 0,
  mode: 'preview' as const,
};
const getDisabledState = () => disabledState;
const noSubscribe = () => () => undefined;

// Auth already clears this store synchronously on sign-out/account changes.
// Observe that existing lifecycle; do not alter authentication or persist mocks.
export function FamilyPlusPreviewLifecycle() {
  const enabled = canUseFamilyPlusPreview(
    __DEV__,
    process.env.EXPO_PUBLIC_HOMEYPAW_TARGET === 'sandbox'
      ? undefined
      : process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
  useLayoutEffect(() => {
    if (!enabled) {
      familyPlusPreviewMemory.clear();
      return;
    }
    const sync = () => {
      const current = useCurrentFamilyStore.getState();
      familyPlusPreviewMemory.synchronize({
        enabled,
        userId: current.currentFamilyUserId,
        familyId: current.currentFamilyId,
      });
    };
    sync();
    const unsubscribe = useCurrentFamilyStore.subscribe(sync);
    return () => {
      unsubscribe();
      familyPlusPreviewMemory.clear();
    };
  }, [enabled]);
  return null;
}

export function useFamilyPlusPreview(input: {
  userId: string | null;
  familyId: string | null;
  role: FamilyPlusRole;
  loading: boolean;
  error: boolean;
}) {
  const { t } = useTranslation();
  const enabled = canUseFamilyPlusPreview(
    __DEV__,
    process.env.EXPO_PUBLIC_HOMEYPAW_TARGET === 'sandbox'
      ? undefined
      : process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
  const state = useSyncExternalStore(
    enabled ? familyPlusPreviewMemory.subscribe : noSubscribe,
    enabled ? familyPlusPreviewMemory.getSnapshot : getDisabledState,
    getDisabledState,
  );
  const ready =
    enabled &&
    Boolean(input.userId && input.familyId && input.role) &&
    !input.loading &&
    !input.error;
  const scope = {
    enabled: ready,
    userId: input.userId,
    familyId: input.familyId,
  };
  const scene: FamilyPlusPreviewScene = input.loading
    ? 'loading'
    : input.error
      ? 'error'
      : !input.familyId
        ? 'empty'
        : !ready
          ? 'unavailable'
          : familyPlusPreviewMemory.read(scope);
  const snapshot = enabled ? familyPlusPreviewSnapshot(true, scene) : null;
  const identity = snapshot ? familyPlusIdentity(snapshot, enabled) : null;
  const status = ['loading', 'empty', 'error', 'offline'].includes(scene)
    ? scene
    : (identity?.status ?? 'unavailable');
  const label = t('familyPlus.identityPreview', {
    status: t(`familyPlus.identity.${status}`),
  });
  return {
    enabled,
    mode: familyPlusPreviewMemory.readMode({
      enabled,
      userId: input.userId,
      familyId: input.familyId,
    }),
    scene,
    snapshot,
    label,
    setScene: (next: FamilyPlusPreviewScene) =>
      familyPlusPreviewMemory.select(scope, next, state.generation),
    setServerMode: () =>
      familyPlusPreviewMemory.selectServer(scope, state.generation),
  };
}
