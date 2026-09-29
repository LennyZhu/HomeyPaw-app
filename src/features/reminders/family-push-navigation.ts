import type { Href } from 'expo-router';

export type ChatPushNavigationTarget = {
  href: '/chat';
  familyId: string;
  messageId: string;
  type: 'chat_message';
};

export type FamilyPushNavigationTarget =
  | ChatPushNavigationTarget
  | {
      href: Href;
      petId: string;
      sourceId: string;
      type: 'journal_created' | 'care_log_created' | 'reminder_created';
    };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function getFamilyPushNavigationTarget(
  data: Record<string, unknown>,
): FamilyPushNavigationTarget | null {
  const { petId, sourceId, type } = data;
  if (type === 'chat_message') {
    const { familyId, messageId } = data;
    if (
      typeof familyId !== 'string' ||
      typeof messageId !== 'string' ||
      !uuidPattern.test(familyId) ||
      !uuidPattern.test(messageId)
    )
      return null;
    return { href: '/chat', familyId, messageId, type };
  }
  if (
    typeof petId !== 'string' ||
    typeof sourceId !== 'string' ||
    !uuidPattern.test(petId) ||
    !uuidPattern.test(sourceId)
  ) {
    return null;
  }
  if (type === 'journal_created') {
    return { href: `/posts/${sourceId}` as Href, petId, sourceId, type };
  }
  if (type === 'care_log_created') {
    return { href: '/care', petId, sourceId, type };
  }
  if (type === 'reminder_created') {
    return {
      href: `/reminders/${sourceId}` as Href,
      petId,
      sourceId,
      type,
    };
  }
  return null;
}

export function canOpenChatPushTarget(
  target: ChatPushNavigationTarget,
  currentFamilyId: string | null,
  membershipRole: string | null,
) {
  return (
    target.familyId === currentFamilyId &&
    (membershipRole === 'owner' || membershipRole === 'member')
  );
}
