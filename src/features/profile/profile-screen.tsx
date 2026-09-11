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
import { useProfileAvatarUrl } from './profile-avatar';
import { getProfilePresentationState } from './profile-query-state';

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
  const avatarQuery = useProfileAvatarUrl(profile?.avatar_url ?? null);
  const presentation = getProfilePresentationState({
    hasError: Boolean(error),
    hasProfile: Boolean(profile),
    isPending: isLoading,
  });
  const profileEmail = user?.email ?? t('profile.emailUnavailable');
  const profileLanguage =
    profile?.locale === 'en' ? t('profile.english') : t('profile.zhHK');

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

      {presentation.showInitialLoading ? (
        <LoadingView label={t('profile.loading')} />
      ) : null}
      {presentation.showInitialError ? (
        <View style={styles.errorState}>
          <AppText tone="error">{t('profile.loadError')}</AppText>
          <AppButton
            label={t('common.retry')}
            onPress={() => void refetch().catch(() => undefined)}
            variant="secondary"
          />
        </View>
      ) : null}

      {presentation.showContent && profile ? (
        <>
          <Pressable
            accessibilityHint={t('profile.editProfile')}
            accessibilityLabel={`${profile.display_name}, ${profileEmail}, ${profileLanguage}`}
            accessibilityRole="button"
            onPress={() => router.push('/edit-profile')}
            style={({ pressed }) => [
              styles.profileHeader,
              pressed && styles.pressed,
            ]}
          >
            <Avatar
              accessibilityLabel={t('profile.avatar')}
              name={profile.display_name}
              size={82}
              source={avatarQuery.data ? { uri: avatarQuery.data } : undefined}
            />
            <View style={styles.profileCopy}>
              <AppText variant="title2">{profile.display_name}</AppText>
              <AppText
                accessibilityLabel={profileEmail}
                ellipsizeMode="tail"
                numberOfLines={1}
                style={styles.email}
                tone="secondary"
                variant="subheadline"
              >
                {profileEmail}
              </AppText>
              <AppText tone="secondary" variant="footnote">
                {profile.locale === 'en'
                  ? t('profile.english')
                  : t('profile.zhHK')}
              </AppText>
            </View>
          </Pressable>

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
    minWidth: 0,
    flex: 1,
    gap: spacing.xs,
    paddingLeft: spacing.lg,
  },
  email: { flexShrink: 1 },
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
