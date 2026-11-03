import { onlineManager, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { familyKeys } from '@/features/family/family-query-keys';
import { readFamilyPlusSummary } from './family-plus-api';
import {
  emptyFamilyPlusServerSnapshot,
  familyPlusServerSnapshot,
} from './family-plus-data';
import {
  familyPlusIdentity,
  type FamilyPlusRole,
} from './family-plus-presentation';
import { useFamilyPlusPreview } from './use-family-plus-preview';
import type { FamilyPlusPreviewScene } from './family-plus-preview';
import {
  isFamilyPlusSandbox,
  isFamilyPlusRelease,
} from './family-plus-environment';

export const familyPlusKeys = (userId: string | undefined, familyId: string) =>
  [...familyKeys.detail(userId, familyId), 'plus-summary'] as const;

export function useFamilyPlus(input: {
  userId: string | null;
  familyId: string | null;
  role: FamilyPlusRole;
  loading: boolean;
  error: boolean;
}) {
  const preview = useFamilyPlusPreview(input);
  const sandbox = isFamilyPlusSandbox();
  const live = sandbox || isFamilyPlusRelease();
  const serverMode = live || preview.mode === 'server';
  const { t } = useTranslation();
  const online = useSyncExternalStore(
    onlineManager.subscribe,
    () => onlineManager.isOnline(),
    () => false,
  );
  const ready =
    (live || preview.enabled) &&
    serverMode &&
    Boolean(input.userId && input.familyId && input.role) &&
    !input.loading &&
    !input.error;
  const query = useQuery({
    queryKey: familyPlusKeys(input.userId ?? undefined, input.familyId ?? ''),
    queryFn: ({ signal }) =>
      readFamilyPlusSummary(input.userId!, input.familyId!, signal),
    enabled: ready && online,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  });
  if (!serverMode)
    return { ...preview, role: input.role, retry: () => undefined };
  const matching =
    query.data?.summary.family_id === input.familyId &&
    query.data?.summary.viewer_user_id === input.userId;
  const snapshot =
    ready &&
    online &&
    !query.isError &&
    !query.isPending &&
    matching &&
    query.data
      ? familyPlusServerSnapshot(query.data.summary, query.data.receivedAt)
      : emptyFamilyPlusServerSnapshot;
  const identity = familyPlusIdentity(snapshot, false);
  const scene: FamilyPlusPreviewScene = input.loading
    ? 'loading'
    : !input.familyId
      ? 'empty'
      : !online
        ? 'offline'
        : input.error
          ? 'error'
          : query.isError
            ? 'error'
            : query.isPending && ready
              ? 'loading'
              : identity.status;
  return {
    ...preview,
    enabled: live || preview.enabled,
    mode: 'server' as const,
    snapshot,
    scene,
    role:
      query.data && matching && ready && online && !query.isError
        ? query.data.summary.role
        : null,
    label: t(
      isFamilyPlusRelease()
        ? 'familyPlus.identityServer'
        : sandbox
          ? 'familyPlus.identitySandbox'
          : 'familyPlus.identityLocal',
      {
        status: t(`familyPlus.identity.${scene}`),
      },
    ),
    retry: () => {
      if (ready && online) void query.refetch();
    },
  };
}
