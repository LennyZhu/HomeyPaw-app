import type { TFunction } from 'i18next';

type HistoricalActorDisplayNameInput = {
  actorId: string | null;
  displayName: string | null | undefined;
  t: TFunction;
};

export function resolveHistoricalActorDisplayName({
  actorId,
  displayName,
  t,
}: HistoricalActorDisplayNameInput) {
  if (actorId === null) return t('common.deletedUser');
  return displayName?.trim() || t('family.members.formerMember');
}
