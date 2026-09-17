export type ScheduleAssigneeMember = {
  avatarPath: string | null;
  avatarUrl: string | null;
  displayName: string;
  role: string;
  userId: string;
};

export type ScheduleAssigneeOption =
  | {
      avatarUrl: null;
      avatarPath: null;
      displayName: null;
      userId: null;
    }
  | {
      avatarUrl: string | null;
      avatarPath: string | null;
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
      { avatarPath: null, avatarUrl: null, displayName: null, userId: null },
      ...currentMembers.map(
        ({ avatarPath, avatarUrl, displayName, userId }) => ({
          avatarPath,
          avatarUrl,
          displayName,
          userId,
        }),
      ),
    ];
  }

  if (role === 'member') {
    return currentMembers
      .filter((member) => member.userId === currentUserId)
      .map(({ avatarPath, avatarUrl, displayName, userId }) => ({
        avatarPath,
        avatarUrl,
        displayName,
        userId,
      }));
  }

  return [];
}
