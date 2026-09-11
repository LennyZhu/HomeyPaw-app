export type ScheduleAssigneeMember = {
  avatarUrl: string | null;
  displayName: string;
  role: string;
  userId: string;
};

export type ScheduleAssigneeOption =
  | {
      avatarUrl: null;
      displayName: null;
      userId: null;
    }
  | {
      avatarUrl: string | null;
      displayName: string;
      userId: string;
    };

export function getScheduleAssigneeOptions(
  members: ScheduleAssigneeMember[],
  role: string | null,
  currentUserId: string | undefined,
): ScheduleAssigneeOption[] {
  const currentMembers = members.filter(
    (member) => member.role === 'owner' || member.role === 'member',
  );

  if (role === 'owner') {
    return [
      { avatarUrl: null, displayName: null, userId: null },
      ...currentMembers.map(({ avatarUrl, displayName, userId }) => ({
        avatarUrl,
        displayName,
        userId,
      })),
    ];
  }

  if (role === 'member') {
    return currentMembers
      .filter((member) => member.userId === currentUserId)
      .map(({ avatarUrl, displayName, userId }) => ({
        avatarUrl,
        displayName,
        userId,
      }));
  }

  return [];
}
