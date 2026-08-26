import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { type Href, useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
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

export default function AboutScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const build = Constants.nativeBuildVersion ?? '1';

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
        <AppText tone="tertiary" variant="footnote">
          {t('about.version', { build, version })}
        </AppText>
      </View>

      <View style={styles.card}>
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
  pressed: { backgroundColor: lightColors.surfaceSecondary },
  contactCard: {
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.lg,
    gap: spacing.md,
    padding: spacing.lg,
  },
  contactTitle: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
