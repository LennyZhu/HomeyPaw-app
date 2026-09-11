import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import {
  contentStyles,
  useContentLayout,
} from '@/components/content-container';
import { modalSupportedOrientations } from '@/config/orientation';
import { lightColors, radius, shadows, spacing } from '@/theme';

type Props = {
  onAddPet: () => void;
  onCancel: () => void;
  onJoinFamily: () => void;
  visible: boolean;
};

export function PetsCreateActionsModal({
  onAddPet,
  onCancel,
  onJoinFamily,
  visible,
}: Props) {
  const { t } = useTranslation();
  const { isWide } = useContentLayout('modal');

  return (
    <Modal
      animationType={isWide ? 'fade' : 'slide'}
      onRequestClose={onCancel}
      supportedOrientations={modalSupportedOrientations}
      transparent
      visible={visible}
    >
      <Pressable
        accessible={false}
        onPress={onCancel}
        style={[styles.overlay, isWide && styles.overlayWide]}
      >
        <View style={styles.safeArea}>
          <Pressable
            accessibilityViewIsModal
            accessible={false}
            onPress={(event) => event.stopPropagation()}
            style={styles.sheet}
          >
            <AppText
              accessibilityRole="header"
              style={styles.title}
              variant="headline"
            >
              {t('pets.list.actionsTitle')}
            </AppText>
            <View style={styles.actions}>
              <ActionRow
                icon="paw-outline"
                label={t('pets.list.addPet')}
                onPress={onAddPet}
              />
              <ActionRow
                icon="people-outline"
                label={t('pets.list.joinFamily')}
                onPress={onJoinFamily}
              />
              <ActionRow
                cancel
                icon="close-outline"
                label={t('common.cancel')}
                onPress={onCancel}
              />
            </View>
            <SafeAreaView edges={isWide ? [] : ['bottom']} />
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function ActionRow({
  cancel = false,
  icon,
  label,
  onPress,
}: {
  cancel?: boolean;
  icon: 'close-outline' | 'paw-outline' | 'people-outline';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        cancel && styles.cancelAction,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={lightColors.textPrimary} name={icon} size={22} />
      <AppText style={styles.actionLabel}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: lightColors.overlay,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
  },
  overlayWide: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  safeArea: { ...contentStyles.modal },
  sheet: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.subtle,
  },
  title: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  actions: {
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    minHeight: 56,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  actionLabel: { flex: 1 },
  cancelAction: {
    backgroundColor: lightColors.surfaceSecondary,
    borderBottomWidth: 0,
  },
  pressed: { opacity: 0.62 },
});
