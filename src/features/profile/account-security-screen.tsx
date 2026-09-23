import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { familyLabel } from '@/features/family/family-label';
import { useFamilies } from '@/features/family/family-queries';
import { usePets } from '@/features/pets/pet-queries';
import { requireSupabase } from '@/lib/supabase/client';
import { lightColors, radius, spacing } from '@/theme';

export default function AccountSecurityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const familiesQuery = useFamilies();
  const petsQuery = usePets();
  const [isDeleting, setIsDeleting] = useState(false);
  const [ownerBlocked, setOwnerBlocked] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [webConfirmationStep, setWebConfirmationStep] = useState<0 | 1 | 2>(0);

  const deleteAccount = async () => {
    setDeleteError(null);
    setIsDeleting(true);

    try {
      const { error } = await requireSupabase().functions.invoke(
        'delete-account',
        { body: { confirmation: 'DELETE_MY_ACCOUNT' } },
      );

      if (error) {
        const context = (
          error as {
            context?: { status?: number; json?: () => Promise<unknown> };
          }
        ).context;
        const payload =
          context?.status === 409 && context.json
            ? await context.json().catch(() => null)
            : null;
        if (
          context?.status === 409 &&
          payload &&
          typeof payload === 'object' &&
          'error' in payload &&
          payload.error === 'ACCOUNT_OWNS_FAMILY'
        ) {
          setOwnerBlocked(true);
          setWebConfirmationStep(0);
          await familiesQuery.refetch();
          await petsQuery.refetch();
          return;
        }
        throw error;
      }

      await signOut().catch(() => undefined);
    } catch {
      if (Platform.OS === 'web') {
        setDeleteError(t('accountSecurity.deleteError'));
      } else {
        Alert.alert(t('common.error'), t('accountSecurity.deleteError'));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmDeletionAgain = () => {
    Alert.alert(
      t('accountSecurity.finalConfirmTitle'),
      t('accountSecurity.finalConfirmBody'),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          style: 'destructive',
          text: t('accountSecurity.deleteAction'),
          onPress: () => void deleteAccount(),
        },
      ],
    );
  };

  const confirmDeletion = () => {
    if (Platform.OS === 'web') {
      setDeleteError(null);
      setWebConfirmationStep(1);
      return;
    }

    Alert.alert(
      t('accountSecurity.confirmTitle'),
      t('accountSecurity.confirmBody'),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          style: 'destructive',
          text: t('common.continue'),
          onPress: confirmDeletionAgain,
        },
      ],
    );
  };

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('accountSecurity.title')}
      </AppText>
      <AppText style={styles.subtitle} tone="secondary">
        {t('accountSecurity.subtitle')}
      </AppText>

      <View style={styles.dangerZone}>
        <AppText tone="error" variant="footnote">
          {t('accountSecurity.dangerZone')}
        </AppText>
        <AppText variant="headline">
          {t('accountSecurity.deleteAction')}
        </AppText>
        <AppText tone="secondary">
          {t('accountSecurity.deleteDescription')}
        </AppText>
        {deleteError ? <AppText tone="error">{deleteError}</AppText> : null}
        {ownerBlocked ? (
          <View style={styles.ownerResolution}>
            <AppText variant="headline">
              {t('accountSecurity.ownsFamilyTitle')}
            </AppText>
            <AppText>{t('accountSecurity.ownsFamilyBody')}</AppText>
            {familiesQuery.data
              ?.filter((access) => access.membership.role === 'owner')
              .map(({ family }) => (
                <View key={family.id} style={styles.ownedFamily}>
                  <AppText>
                    {familyLabel(family, petsQuery.data ?? [], t)}
                  </AppText>
                  <AppButton
                    label={t('family.lifecycle.manage')}
                    onPress={() =>
                      router.push({
                        pathname: '/families/[id]',
                        params: { id: family.id },
                      })
                    }
                    variant="secondary"
                  />
                </View>
              ))}
            {familiesQuery.isError || petsQuery.isError ? (
              <AppText tone="error">{t('family.lifecycle.loadError')}</AppText>
            ) : null}
            <AppButton
              label={t('profile.manageFamilies')}
              onPress={() => router.push('/families')}
              variant="secondary"
            />
          </View>
        ) : null}
        {Platform.OS === 'web' && webConfirmationStep > 0 ? (
          <View style={styles.webConfirmation}>
            <AppText variant="headline">
              {webConfirmationStep === 1
                ? t('accountSecurity.confirmTitle')
                : t('accountSecurity.finalConfirmTitle')}
            </AppText>
            <AppText>
              {webConfirmationStep === 1
                ? t('accountSecurity.confirmBody')
                : t('accountSecurity.finalConfirmBody')}
            </AppText>
            <View style={styles.webConfirmationActions}>
              <AppButton
                disabled={isDeleting}
                label={t('common.cancel')}
                onPress={() => setWebConfirmationStep(0)}
                variant="secondary"
              />
              <AppButton
                label={
                  webConfirmationStep === 1
                    ? t('common.continue')
                    : t('accountSecurity.deleteAction')
                }
                loading={isDeleting}
                onPress={() => {
                  if (webConfirmationStep === 1) {
                    setWebConfirmationStep(2);
                  } else {
                    void deleteAccount();
                  }
                }}
                variant="danger"
              />
            </View>
          </View>
        ) : (
          <AppButton
            accessibilityLabel={`${t('accountSecurity.dangerZone')}: ${t('accountSecurity.deleteAction')}`}
            label={t('accountSecurity.deleteAction')}
            loading={isDeleting}
            onPress={confirmDeletion}
            style={styles.deleteButton}
            variant="danger"
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.md,
  },
  subtitle: {
    marginTop: spacing.sm,
  },
  dangerZone: {
    gap: spacing.md,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.huge,
    padding: spacing.xl,
  },
  deleteButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  webConfirmation: {
    gap: spacing.md,
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.lg,
  },
  webConfirmationActions: {
    gap: spacing.md,
  },
  ownerResolution: {
    gap: spacing.md,
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.lg,
  },
  ownedFamily: { gap: spacing.sm, paddingVertical: spacing.sm },
});
