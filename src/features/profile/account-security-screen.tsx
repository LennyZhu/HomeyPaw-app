import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { requireSupabase } from '@/lib/supabase/client';
import { lightColors, radius, spacing } from '@/theme';

export default function AccountSecurityScreen() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);
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
        <AppText tone="error" variant="headline">
          {t('accountSecurity.dangerZone')}
        </AppText>
        <AppText>{t('accountSecurity.deleteDescription')}</AppText>
        {deleteError ? <AppText tone="error">{deleteError}</AppText> : null}
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
            label={t('accountSecurity.deleteAction')}
            loading={isDeleting}
            onPress={confirmDeletion}
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
    gap: spacing.lg,
    backgroundColor: '#F9E7E7',
    borderColor: lightColors.error,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.huge,
    padding: spacing.xl,
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
});
