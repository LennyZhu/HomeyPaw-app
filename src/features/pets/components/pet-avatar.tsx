import { useRef } from 'react';

import { Avatar } from '@/components/avatar';

import { usePetAvatarUrl } from '../pet-queries';

type PetAvatarProps = {
  accessibilityLabel: string;
  avatarPath: string | null;
  name: string;
  localUri?: string | null | undefined;
  size?: number | undefined;
};

export function PetAvatar({
  accessibilityLabel,
  avatarPath,
  name,
  localUri,
  size,
}: PetAvatarProps) {
  const signedUrl = usePetAvatarUrl(localUri ? null : avatarPath);
  const uri = localUri ?? signedUrl.data;
  const lastRecoveryAt = useRef(0);

  const recoverExpiredUrl = () => {
    if (localUri || Date.now() - lastRecoveryAt.current < 60_000) {
      return;
    }
    lastRecoveryAt.current = Date.now();
    void signedUrl.refetch();
  };

  return (
    <Avatar
      accessibilityLabel={accessibilityLabel}
      name={name}
      {...(size === undefined ? {} : { size })}
      {...(uri ? { onError: recoverExpiredUrl, source: { uri } } : {})}
    />
  );
}
