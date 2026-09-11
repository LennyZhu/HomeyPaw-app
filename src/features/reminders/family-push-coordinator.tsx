import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import {
  getCareTaskNotificationPermission,
  requestCareTaskNotificationPermission,
} from '@/services/care-task-notifications';
import {
  hasSharedFamilyForPush,
  hasShownFamilyPushPreprompt,
  markFamilyPushPrepromptShown,
  registerFamilyPushDevice,
  unregisterFamilyPushDevice,
} from '@/services/family-push-device';

import { FamilyPushPermissionPrompt } from './family-push-permission-prompt';

export function FamilyPushCoordinator() {
  const {
    isPasswordRecovery,
    isProcessingAuthCallback,
    isProfileSetupPending,
    session,
  } = useAuth();
  const [showPrompt, setShowPrompt] = useState(false);
  const canRun = Boolean(
    session &&
    !isPasswordRecovery &&
    !isProcessingAuthCallback &&
    !isProfileSetupPending &&
    Platform.OS !== 'web',
  );

  useEffect(() => {
    if (!canRun || !session) return;

    let active = true;
    const refresh = async () => {
      try {
        const permission = await getCareTaskNotificationPermission();
        if (!active) return;
        if (permission === 'granted') {
          setShowPrompt(false);
          await registerFamilyPushDevice();
          return;
        }
        if (permission === 'denied') {
          setShowPrompt(false);
          await unregisterFamilyPushDevice().catch(() => false);
          return;
        }
        if (
          !hasShownFamilyPushPreprompt(session.user.id) &&
          (await hasSharedFamilyForPush()) &&
          active
        ) {
          setShowPrompt(true);
        }
      } catch {
        // Foreground/session resume retries registration without blocking use.
      }
    };

    void refresh();
    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (state === 'active') void refresh();
      },
    );
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      void refresh();
    });
    return () => {
      active = false;
      appStateSubscription.remove();
      tokenSubscription.remove();
    };
  }, [canRun, session]);

  const enable = async () => {
    if (!session) return;
    markFamilyPushPrepromptShown(session.user.id);
    setShowPrompt(false);
    try {
      if ((await requestCareTaskNotificationPermission()) === 'granted') {
        await registerFamilyPushDevice();
      }
    } catch {
      // Permission/token failures remain optional and retry on foreground.
    }
  };

  const later = () => {
    if (session) markFamilyPushPrepromptShown(session.user.id);
    setShowPrompt(false);
  };

  return (
    <FamilyPushPermissionPrompt
      onEnable={() => void enable()}
      onLater={later}
      visible={canRun && showPrompt}
    />
  );
}
