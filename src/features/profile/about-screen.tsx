import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import { Image } from 'expo-image';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import {
  compareNumericVersions,
  HOMEYPAW_APP_STORE_URL,
  lookupLatestAppStoreVersion,
} from '@/features/profile/about-update';
import { lightColors, radius, spacing } from '@/theme';

const links = [
  {
    icon: 'shield-checkmark-outline',
    key: 'privacy',
    route: '/privacy-policy',
  },
  { icon: 'document-text-outline', key: 'terms', route: '/terms-of-service' },
] as const;

const supportEmail = 'lenny996@163.com';

type UpdateState =
  | { status: 'checking' }
  | { status: 'error' }
  | { status: 'latest' }
  | { status: 'available'; version: string };

export default function AboutScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const version = Application.nativeApplicationVersion ?? '—';
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: 'checking',
  });
  const requestIdRef = useRef(0);

  const finishUpdateCheck = useCallback(
    async (requestId: number) => {
      try {
        const storeVersion = await lookupLatestAppStoreVersion();
        if (requestIdRef.current !== requestId) return;

        const comparison = compareNumericVersions(version, storeVersion);
        if (comparison === null) {
          throw new Error('Installed app version is not a semantic version.');
        }

        setUpdateState(
          comparison > 0
            ? { status: 'available', version: storeVersion }
            : { status: 'latest' },
        );
      } catch {
        if (requestIdRef.current === requestId) {
          setUpdateState({ status: 'error' });
        }
      }
    },
    [version],
  );

  const checkForUpdates = useCallback(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setUpdateState({ status: 'checking' });
    void finishUpdateCheck(requestId);
  }, [finishUpdateCheck]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    void finishUpdateCheck(requestId);

    return () => {
      requestIdRef.current += 1;
    };
  }, [finishUpdateCheck]);

  const openAppStore = async () => {
    try {
      await Linking.openURL(HOMEYPAW_APP_STORE_URL);
    } catch {
      Alert.alert(t('common.error'), t('about.appStoreOpenError'));
    }
  };

  const handleUpdatePress = () => {
    if (updateState.status !== 'available') {
      checkForUpdates();
      return;
    }

    Alert.alert(
      t('about.checkForUpdates'),
      t('about.updateAvailable', { version: updateState.version }),
      [
        { style: 'cancel', text: t('about.later') },
        { text: t('about.openAppStore'), onPress: () => void openAppStore() },
      ],
    );
  };

  const updateStatus =
    updateState.status === 'checking'
      ? t('about.checking')
      : updateState.status === 'latest'
        ? t('about.upToDate')
        : updateState.status === 'available'
          ? t('about.updateAvailable', { version: updateState.version })
          : t('about.checkError');

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.back()}
        />
        <AppText
          accessibilityRole="header"
          style={styles.headerTitle}
          variant="title1"
        >
          {t('about.title')}
        </AppText>
      </View>

      <View style={styles.hero}>
        <View accessibilityElementsHidden style={styles.mark}>
          <Image
            contentFit="contain"
            source={require('../../../assets/branding/homeypaw-mark-transparent.png')}
            style={styles.markImage}
          />
        </View>
        <AppText variant="title2">HomeyPaw</AppText>
        <AppText style={styles.centered} tone="secondary">
          {t('about.tagline')}
        </AppText>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons
            color={lightColors.secondary}
            name="information-circle-outline"
            size={22}
          />
          <AppText style={styles.rowText}>{t('about.currentVersion')}</AppText>
          <AppText tone="secondary">{version}</AppText>
        </View>
        <Pressable
          accessibilityLabel={`${t('about.checkForUpdates')}: ${updateStatus}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: updateState.status === 'checking' }}
          disabled={updateState.status === 'checking'}
          onPress={handleUpdatePress}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Ionicons
            color={lightColors.secondary}
            name="cloud-download-outline"
            size={22}
          />
          <View style={styles.updateText}>
            <AppText>{t('about.checkForUpdates')}</AppText>
            <AppText
              accessibilityLiveRegion="polite"
              tone={updateState.status === 'available' ? 'brand' : 'secondary'}
              variant="footnote"
            >
              {updateStatus}
            </AppText>
          </View>
          {updateState.status === 'checking' ? null : (
            <Ionicons
              color={lightColors.textTertiary}
              name="chevron-forward"
              size={18}
            />
          )}
        </Pressable>
        {links.map((item) => (
          <Pressable
            accessibilityLabel={t(`about.${item.key}`)}
            accessibilityRole="button"
            key={item.key}
            onPress={() => router.push(item.route as Href)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Ionicons
              color={lightColors.secondary}
              name={item.icon}
              size={22}
            />
            <AppText style={styles.rowText}>{t(`about.${item.key}`)}</AppText>
            <Ionicons
              color={lightColors.textTertiary}
              name="chevron-forward"
              size={18}
            />
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityLabel={`${t('about.contact')}: ${supportEmail}`}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
        style={({ pressed }) => [styles.contactCard, pressed && styles.pressed]}
      >
        <View style={styles.contactTitle}>
          <Ionicons
            color={lightColors.secondary}
            name="mail-outline"
            size={22}
          />
          <AppText variant="headline">{t('about.contact')}</AppText>
        </View>
        <AppText tone="brand">{supportEmail}</AppText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xxl, paddingTop: spacing.md },
  header: { alignItems: 'center', flexDirection: 'row' },
  headerTitle: { flex: 1, marginLeft: spacing.md },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  mark: {
    alignItems: 'center',
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    height: 82,
    justifyContent: 'center',
    width: 82,
  },
  markImage: { height: 62, width: 62 },
  centered: { maxWidth: 320, textAlign: 'center' },
  card: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: spacing.lg,
  },
  rowText: { flex: 1, paddingHorizontal: spacing.md },
  updateText: { flex: 1, gap: spacing.xs, paddingHorizontal: spacing.md },
  pressed: { backgroundColor: lightColors.surfaceSecondary },
  contactCard: {
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.lg,
    gap: spacing.md,
    padding: spacing.lg,
  },
  contactTitle: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
