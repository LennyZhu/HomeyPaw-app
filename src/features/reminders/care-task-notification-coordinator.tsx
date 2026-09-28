import * as Notifications from 'expo-notifications';
import { type Href, router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/features/auth/auth-context';
import { useCurrentFamily } from '@/features/family/use-current-family';
import { syncCareTaskNotifications } from '@/services/care-task-notifications';
import { requireSupabase } from '@/lib/supabase/client';
import { useCurrentPetStore } from '@/stores/current-pet-store';

import {
  getFamilyPushNavigationTarget,
  canOpenChatPushTarget,
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
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const {
    session,
    isPasswordRecovery,
    isProcessingAuthCallback,
    isProfileSetupPending,
  } = useAuth();
  const familyState = useCurrentFamily();
  const currentFamilyId = familyState.currentFamilyId;
  const familyContextPending =
    familyState.capabilityQuery.isPending ||
    familyState.familiesQuery.isPending ||
    familyState.petsQuery.isPending;
  const familyContextError =
    familyState.capabilityQuery.isError ||
    familyState.familiesQuery.isError ||
    familyState.petsQuery.isError;
  const handledResponseId = useRef<string | null>(null);
  const pendingResponse = useRef<Notifications.NotificationResponse | null>(
    null,
  );

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
    let active = true;
    let processingResponseId: string | null = null;

    const canOpenFamilyPushTarget = async (
      target: FamilyPushNavigationTarget,
    ) => {
      if (target.type === 'chat_message') {
        if (familyContextError || !session) return false;
        const membership = await requireSupabase()
          .from('family_members')
          .select('role')
          .eq('family_id', target.familyId)
          .eq('user_id', session.user.id)
          .maybeSingle();
        return (
          !membership.error &&
          canOpenChatPushTarget(
            target,
            currentFamilyId,
            membership.data?.role ?? null,
          )
        );
      }
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
      const responseId = response.notification.request.identifier;
      if (
        !session ||
        !navigationReady ||
        isPasswordRecovery ||
        isProcessingAuthCallback ||
        isProfileSetupPending ||
        handledResponseId.current === responseId ||
        processingResponseId === responseId
      )
        return;
      const data = response.notification.request.content.data ?? {};
      const familyTarget = getFamilyPushNavigationTarget(data);
      // Typed Chat identity wins over any unrelated legacy url/Pet fields.
      const url =
        data.type === 'chat_message' ? null : getSafeReminderUrl(response);
      if (!url && !familyTarget) return;
      if (familyTarget?.type === 'chat_message' && familyContextPending) return;
      processingResponseId = responseId;
      if (url) {
        const petId = data?.petId;
        if (typeof petId === 'string' && /^[0-9a-f-]{36}$/u.test(petId)) {
          useCurrentPetStore.getState().setCurrentPetId(petId, session.user.id);
        }
        router.push(url as Href);
      } else {
        const canOpen =
          familyTarget &&
          (await canOpenFamilyPushTarget(familyTarget).catch(() => false));
        if (!active) return;
        if (canOpen && familyTarget) {
          if (familyTarget.type !== 'chat_message') {
            useCurrentPetStore
              .getState()
              .setCurrentPetId(familyTarget.petId, session.user.id);
          }
          router.push(familyTarget.href);
        } else {
          router.replace('/');
        }
      }
      handledResponseId.current = responseId;
      if (
        pendingResponse.current?.notification.request.identifier === responseId
      ) {
        pendingResponse.current = null;
      }
      processingResponseId = null;
      void Notifications.clearLastNotificationResponseAsync();
    };

    const lastResponse =
      pendingResponse.current ?? Notifications.getLastNotificationResponse();
    if (lastResponse) {
      pendingResponse.current = lastResponse;
      void handleResponse(lastResponse);
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        pendingResponse.current = response;
        void handleResponse(response);
      },
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [
    currentFamilyId,
    familyContextError,
    familyContextPending,
    isPasswordRecovery,
    isProcessingAuthCallback,
    isProfileSetupPending,
    navigationReady,
    session,
  ]);

  return null;
}
