import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
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

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type PostComposerAction = {
  destructive?: boolean;
  icon: IoniconName;
  label: string;
  onPress: () => void;
};

type Props = {
  actions: PostComposerAction[];
  onCancel: () => void;
  title: string;
  visible: boolean;
};

export function PostComposerActionModal({
  actions,
  onCancel,
  title,
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
              {title}
            </AppText>
            <View style={styles.actions}>
              {actions.map((action) => (
                <Pressable
                  accessibilityLabel={action.label}
                  accessibilityRole="button"
                  key={action.label}
                  onPress={() => {
                    onCancel();
                    action.onPress();
                  }}
                  style={({ pressed }) => [
                    styles.action,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    color={
                      action.destructive
                        ? lightColors.error
                        : lightColors.textPrimary
                    }
                    name={action.icon}
                    size={22}
                  />
                  <AppText
                    style={[
                      styles.actionLabel,
                      action.destructive && styles.destructiveLabel,
                    ]}
                    variant="body"
                  >
                    {action.label}
                  </AppText>
                </Pressable>
              ))}
              <Pressable
                accessibilityLabel={t('common.cancel')}
                accessibilityRole="button"
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.action,
                  styles.cancelAction,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  color={lightColors.textPrimary}
                  name="close-outline"
                  size={22}
                />
                <AppText style={styles.actionLabel} variant="body">
                  {t('common.cancel')}
                </AppText>
              </Pressable>
            </View>
            <SafeAreaView edges={isWide ? [] : ['bottom']} />
          </Pressable>
        </View>
      </Pressable>
    </Modal>
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
  destructiveLabel: { color: lightColors.error },
  cancelAction: {
    backgroundColor: lightColors.surfaceSecondary,
    borderBottomWidth: 0,
  },
  pressed: { opacity: 0.62 },
});
