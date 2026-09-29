import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import {
  contentStyles,
  useContentLayout,
} from '@/components/content-container';
import { IconButton } from '@/components/icon-button';
import { modalSupportedOrientations } from '@/config/orientation';
import { createStorageImageSource } from '@/features/media/storage-signed-url';
import { profileAvatarBucket } from '@/features/profile/profile-avatar';
import { lightColors, radius, shadows, spacing } from '@/theme';

import type { PostReader } from '../post-read-queries';

export function PostReadersModal({
  readers,
  loading,
  error,
  onRetry,
  onClose,
}: {
  readers: PostReader[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { i18n, t } = useTranslation();
  const { height, isWide } = useContentLayout('modal');
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <Modal
      animationType={isWide ? 'fade' : 'slide'}
      onRequestClose={onClose}
      supportedOrientations={modalSupportedOrientations}
      transparent
      visible
    >
      <Pressable
        accessible={false}
        onPress={onClose}
        style={[styles.overlay, isWide && styles.overlayWide]}
      >
        <View style={styles.container}>
          <Pressable
            accessibilityViewIsModal
            accessible={false}
            onAccessibilityEscape={onClose}
            onPress={(event) => event.stopPropagation()}
            style={[styles.sheet, { maxHeight: height * 0.65 }]}
          >
            <View style={styles.header}>
              <AppText
                accessibilityRole="header"
                style={styles.title}
                variant="title2"
              >
                {t('posts.readers.title')}
              </AppText>
              <IconButton
                accessibilityLabel={t('common.close')}
                icon="close"
                onPress={onClose}
              />
            </View>
            <ScrollView
              alwaysBounceVertical={false}
              contentContainerStyle={styles.list}
              style={styles.scroll}
            >
              {loading ? (
                <View
                  accessibilityLabel={t('posts.readers.loading')}
                  accessibilityRole="progressbar"
                  style={[styles.message, styles.loading]}
                >
                  <ActivityIndicator color={lightColors.textSecondary} />
                  <AppText tone="secondary" variant="subheadline">
                    {t('posts.readers.loading')}
                  </AppText>
                </View>
              ) : error ? (
                <View style={styles.message}>
                  <AppText tone="secondary">{t('posts.readers.error')}</AppText>
                  <AppButton
                    label={t('common.retry')}
                    onPress={onRetry}
                    variant="secondary"
                  />
                </View>
              ) : readers.length === 0 ? (
                <AppText style={styles.message} tone="secondary">
                  {t('posts.readers.empty')}
                </AppText>
              ) : (
                <View>
                  {readers.map((reader, index) => (
                    <View
                      key={reader.userId}
                      style={[
                        styles.row,
                        index < readers.length - 1 && styles.rowSeparator,
                      ]}
                    >
                      <Avatar
                        accessibilityLabel={t('family.members.avatar', {
                          name: reader.displayName,
                        })}
                        name={reader.displayName}
                        size={46}
                        source={createStorageImageSource(
                          profileAvatarBucket,
                          reader.avatarPath ?? '',
                          reader.avatarUrl,
                        )}
                      />
                      <View style={styles.copy}>
                        <AppText variant="headline">
                          {reader.displayName}
                        </AppText>
                        <AppText tone="secondary" variant="footnote">
                          {formatter.format(new Date(reader.firstReadAt))}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
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
  container: {
    ...contentStyles.modal,
  },
  sheet: {
    backgroundColor: lightColors.background,
    borderRadius: radius.xl,
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    ...shadows.subtle,
  },
  header: {
    flexShrink: 0,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { flex: 1, minWidth: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  row: {
    minHeight: 64,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowSeparator: {
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  message: { paddingVertical: spacing.sm, gap: spacing.md },
  loading: { minHeight: 64, alignItems: 'center', justifyContent: 'center' },
});
