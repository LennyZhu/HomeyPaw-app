import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { syncCareTaskNotifications } from '@/services/care-task-notifications';
import { useCurrentPetStore } from '@/stores/current-pet-store';

const reminderUrlPattern = /^\/reminders\/[0-9a-f-]{36}$/u;

function getSafeReminderUrl(
  response: Notifications.NotificationResponse | null,
) {
  const url = response?.notification.request.content.data?.url;
  return typeof url === 'string' && reminderUrlPattern.test(url) ? url : null;
}

export function CareTaskNotificationCoordinator() {
  const { session } = useAuth();
  const handledResponseId = useRef<string | null>(null);

  useEffect(() => {
    if (!session || Platform.OS === 'web') return;
    void syncCareTaskNotifications(session.user.id).catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncCareTaskNotifications(session.user.id).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [session]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const url = getSafeReminderUrl(response);
      const responseId = response.notification.request.identifier;
      if (!session || !url || handledResponseId.current === responseId) return;
      handledResponseId.current = responseId;
      const petId = response.notification.request.content.data?.petId;
      if (typeof petId === 'string' && /^[0-9a-f-]{36}$/u.test(petId)) {
        useCurrentPetStore.getState().setCurrentPetId(petId);
      }
      router.push(url as Href);
      void Notifications.clearLastNotificationResponseAsync();
    };

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) handleResponse(lastResponse);
    const subscription =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, [session]);

  return null;
}
