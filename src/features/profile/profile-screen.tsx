import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, type ComponentProps } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { useFeedback } from '@/components/feedback-provider';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { lightColors, radius, spacing } from '@/theme';

import { useProfile } from './use-profile';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type MenuKey =
  'myPets' | 'joinFamily' | 'editProfile' | 'accountSecurity' | 'about';

const menuItems: { icon: IoniconName; key: MenuKey }[] = [
  { icon: 'paw-outline', key: 'myPets' },
  { icon: 'people-outline', key: 'joinFamily' },
  { icon: 'person-outline', key: 'editProfile' },
  { icon: 'shield-checkmark-outline', key: 'accountSecurity' },
  { icon: 'information-circle-outline', key: 'about' },
];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { signOut, user } = useAuth();
  const { error, isLoading, profile, refetch } = useProfile();

  useFocusEffect(
    useCallback(() => {
      void refetch().catch(() => undefined);
    }, [refetch]),
  );

  const handleMenuPress = (key: MenuKey) => {
    if (key === 'myPets') {
      router.push('/pets');
    } else if (key === 'joinFamily') {
      router.push('/join-family' as Href);
    } else if (key === 'editProfile') {
      router.push('/edit-profile');
    } else if (key === 'accountSecurity') {
      router.push('/account-security');
    } else {
      router.push('/about' as Href);
    }
  };

  const confirmSignOut = () => {
    const performSignOut = () => {
      void signOut().catch(() => {
        showFeedback(t('auth.errors.generic'), 'error');
      });
    };

    if (Platform.OS === 'web') {
      const confirmed = globalThis.confirm(
        `${t('profile.signOutConfirmTitle')}\n\n${t('profile.signOutConfirmBody')}`,
      );

      if (confirmed) {
        performSignOut();
      }

      return;
    }

    Alert.alert(
      t('profile.signOutConfirmTitle'),
      t('profile.signOutConfirmBody'),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          style: 'destructive',
          text: t('profile.signOut'),
          onPress: performSignOut,
        },
      ],
    );
  };

  return (
    <Screen contentContainerStyle={styles.screenContent} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('profile.title')}
      </AppText>

      {isLoading ? <LoadingView label={t('profile.loading')} /> : null}
      {error ? (
        <View style={styles.errorState}>
          <AppText tone="error">{t('profile.loadError')}</AppText>
          <AppButton
            label={t('common.retry')}
            onPress={() => void refetch().catch(() => undefined)}
            variant="secondary"
          />
        </View>
      ) : null}

      {profile ? (
        <>
          <View style={styles.profileHeader}>
            <Avatar
              accessibilityLabel={t('profile.avatar')}
              name={profile.display_name}
              size={82}
            />
            <View style={styles.profileCopy}>
              <AppText variant="title2">{profile.display_name}</AppText>
              <AppText tone="secondary" variant="subheadline">
                {user?.email ?? t('profile.emailUnavailable')}
              </AppText>
              <AppText tone="tertiary" variant="footnote">
                {profile.locale === 'en'
                  ? t('profile.english')
                  : t('profile.zhHK')}
              </AppText>
            </View>
          </View>

          <View style={styles.menu}>
            {menuItems.map((item) => (
              <Pressable
                accessibilityLabel={t(`profile.${item.key}`)}
                accessibilityRole="button"
                key={item.key}
                onPress={() => handleMenuPress(item.key)}
                style={({ pressed }) => [
                  styles.menuRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.menuIcon}>
                  <Ionicons
                    color={lightColors.secondary}
                    name={item.icon}
                    size={21}
                  />
                </View>
                <AppText style={styles.menuLabel} variant="body">
                  {t(`profile.${item.key}`)}
                </AppText>
                <Ionicons
                  color={lightColors.textTertiary}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
            ))}
          </View>

          <AppButton
            label={t('profile.signOut')}
            onPress={confirmSignOut}
            style={styles.signOutButton}
            variant="secondary"
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.md,
  },
  profileHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.xxxl,
  },
  profileCopy: {
    flex: 1,
    gap: spacing.xs,
    paddingLeft: spacing.lg,
  },
  menu: {
    marginTop: spacing.huge,
  },
  menuRow: {
    minHeight: 62,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  menuIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.md,
    justifyContent: 'center',
  },
  menuLabel: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.58,
  },
  errorState: {
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.xxxl,
  },
  signOutButton: {
    marginTop: spacing.xxxl,
  },
});
