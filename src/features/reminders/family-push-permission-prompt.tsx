import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { contentStyles } from '@/components/content-container';
import { lightColors, radius, spacing } from '@/theme';

type FamilyPushPermissionPromptProps = {
  onEnable: () => void;
  onLater: () => void;
  visible: boolean;
};

export function FamilyPushPermissionPrompt({
  onEnable,
  onLater,
  visible,
}: FamilyPushPermissionPromptProps) {
  const { t } = useTranslation();
  return (
    <Modal
      animationType="fade"
      onRequestClose={onLater}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View accessibilityViewIsModal style={styles.backdrop}>
        <View style={[contentStyles.modal, styles.card]}>
          <View style={styles.iconSurface}>
            <Ionicons
              accessibilityElementsHidden
              color={lightColors.primary}
              importantForAccessibility="no-hide-descendants"
              name="notifications-outline"
              size={28}
            />
          </View>
          <AppText accessibilityRole="header" variant="title2">
            {t('familyPush.permission.title')}
          </AppText>
          <AppText style={styles.body} tone="secondary">
            {t('familyPush.permission.body')}
          </AppText>
          <View style={styles.actions}>
            <AppButton
              label={t('familyPush.permission.enable')}
              onPress={onEnable}
            />
            <AppButton
              label={t('familyPush.permission.later')}
              onPress={onLater}
              variant="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(45, 35, 31, 0.28)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.xxl,
  },
  iconSurface: {
    alignItems: 'center',
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  body: { maxWidth: 360, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
});
