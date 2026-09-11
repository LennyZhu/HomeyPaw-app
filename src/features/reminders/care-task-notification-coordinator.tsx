import * as Notifications from 'expo-notifications';
import { type Href, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { syncCareTaskNotifications } from '@/services/care-task-notifications';
import { requireSupabase } from '@/lib/supabase/client';
import { useCurrentPetStore } from '@/stores/current-pet-store';

import {
  getFamilyPushNavigationTarget,
  type FamilyPushNavigationTarget,
} from './family-push-navigation';

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

    const canOpenFamilyPushTarget = async (
      target: FamilyPushNavigationTarget,
    ) => {
      const pet = await requireSupabase()
        .from('pets')
        .select('id')
        .eq('id', target.petId)
        .maybeSingle();
      if (pet.error || !pet.data) return false;

      if (target.type === 'journal_created') {
        const source = await requireSupabase()
          .from('posts')
          .select('id')
          .eq('id', target.sourceId)
          .eq('pet_id', target.petId)
          .maybeSingle();
        return !source.error && Boolean(source.data);
      }
      if (target.type === 'care_log_created') {
        const source = await requireSupabase()
          .from('care_logs')
          .select('id')
          .eq('id', target.sourceId)
          .eq('pet_id', target.petId)
          .maybeSingle();
        return !source.error && Boolean(source.data);
      }
      const source = await requireSupabase()
        .from('care_tasks')
        .select('id')
        .eq('id', target.sourceId)
        .eq('pet_id', target.petId)
        .maybeSingle();
      return !source.error && Boolean(source.data);
    };

    const handleResponse = async (
      response: Notifications.NotificationResponse,
    ) => {
      const url = getSafeReminderUrl(response);
      const responseId = response.notification.request.identifier;
      if (!session || handledResponseId.current === responseId) return;
      const data = response.notification.request.content.data ?? {};
      const familyTarget = getFamilyPushNavigationTarget(data);
      if (!url && !familyTarget) return;
      handledResponseId.current = responseId;
      if (url) {
        const petId = data?.petId;
        if (typeof petId === 'string' && /^[0-9a-f-]{36}$/u.test(petId)) {
          useCurrentPetStore.getState().setCurrentPetId(petId);
        }
        router.push(url as Href);
      } else if (
        familyTarget &&
        (await canOpenFamilyPushTarget(familyTarget).catch(() => false))
      ) {
        useCurrentPetStore.getState().setCurrentPetId(familyTarget.petId);
        router.push(familyTarget.href);
      } else {
        router.replace('/');
      }
      void Notifications.clearLastNotificationResponseAsync();
    };

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) void handleResponse(lastResponse);
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        void handleResponse(response);
      },
    );
    return () => subscription.remove();
  }, [session]);

  return null;
}
