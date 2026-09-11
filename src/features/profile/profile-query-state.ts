export const profileKeys = {
  detail: (userId: string | undefined) => ['profile', userId] as const,
};

export function getProfilePresentationState({
  hasError,
  hasProfile,
  isPending,
}: {
  hasError: boolean;
  hasProfile: boolean;
  isPending: boolean;
}) {
  return {
    showContent: hasProfile,
    showInitialError: hasError && !hasProfile && !isPending,
    showInitialLoading: isPending && !hasProfile,
  };
}
