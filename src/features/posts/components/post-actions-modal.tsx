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
  canDelete: boolean;
  canEdit: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  visible: boolean;
};

export function PostActionsModal({
  canDelete,
  canEdit,
  onCancel,
  onDelete,
  onEdit,
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
              {t('posts.actions.title')}
            </AppText>
            <View style={styles.actions}>
              {canEdit ? (
                <ActionRow
                  icon="create-outline"
                  label={t('posts.actions.edit')}
                  onPress={onEdit}
                />
              ) : null}
              {canDelete ? (
                <ActionRow
                  destructive
                  hint={t('posts.actions.deleteHint')}
                  icon="trash-outline"
                  label={t('posts.delete.action')}
                  onPress={onDelete}
                />
              ) : null}
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
  destructive = false,
  hint,
  icon,
  label,
  onPress,
}: {
  cancel?: boolean;
  destructive?: boolean;
  hint?: string;
  icon: 'close-outline' | 'create-outline' | 'trash-outline';
  label: string;
  onPress: () => void;
}) {
  const color = destructive ? lightColors.error : lightColors.textPrimary;

  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        cancel && styles.cancelAction,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={color} name={icon} size={22} />
      <AppText style={[styles.actionLabel, { color }]} variant="body">
        {label}
      </AppText>
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
  safeArea: {
    ...contentStyles.modal,
  },
  sheet: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.subtle,
  },
  title: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
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
  cancelAction: {
    backgroundColor: lightColors.surfaceSecondary,
    borderBottomWidth: 0,
  },
  actionLabel: { flex: 1 },
  pressed: { opacity: 0.62 },
});
