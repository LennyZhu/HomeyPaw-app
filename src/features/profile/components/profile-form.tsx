import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { LoadingView } from '@/components/loading-view';
import { useAuth } from '@/features/auth/auth-context';
import { AuthField } from '@/features/auth/components/auth-field';
import { FormMessage } from '@/features/auth/components/form-message';
import {
  hasAvatarImagePermission,
  pickAndPrepareAvatarImage,
  type PreparedAvatarImage,
} from '@/features/media/avatar-image';
import type { SupportedLanguage } from '@/i18n';
import { lightColors, radius, spacing } from '@/theme';
import type { ProfileUpdate } from '@/types/database';

import {
  removeProfileAvatar,
  profileAvatarKeys,
  uploadProfileAvatar,
  useProfileAvatarUrl,
} from '../profile-avatar';
import { useProfile } from '../use-profile';

type AvatarIssue = 'load' | 'permission' | 'prepare';

type ProfileFormProps = {
  emptyAvatarActionLabel?: string;
  nicknameLabel?: string;
  onSaved: () => Promise<void> | void;
  onSecondaryAction?: () => void;
  primaryLabel: string;
  secondaryLabel?: string;
};

export function ProfileForm({
  emptyAvatarActionLabel,
  nicknameLabel,
  onSaved,
  onSecondaryAction,
  primaryLabel,
  secondaryLabel,
}: ProfileFormProps) {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { error, isLoading, profile, refetch, updateProfile } = useProfile();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [avatarIssue, setAvatarIssue] = useState<AvatarIssue | null>(null);
  const [selectedAvatar, setSelectedAvatar] =
    useState<PreparedAvatarImage | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [isPickingAvatar, setIsPickingAvatar] = useState(false);
  const avatarQuery = useProfileAvatarUrl(profile?.avatar_url ?? null);
  const schema = useMemo(
    () =>
      z.object({
        displayName: z
          .string()
          .trim()
          .min(1, t('auth.validation.displayNameRequired'))
          .max(80, t('auth.validation.displayNameTooLong')),
        locale: z.enum(['zh-HK', 'en']),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<Values>({
    defaultValues: { displayName: '', locale: 'zh-HK' },
    resolver: zodResolver(schema),
  });
  const displayName = useWatch({ control, name: 'displayName' });
  const avatarName = displayName || profile?.display_name || '';

  useEffect(() => {
    if (profile) {
      reset({ displayName: profile.display_name, locale: profile.locale });
    }
  }, [profile, reset]);

  useEffect(() => {
    let mounted = true;
    const refreshPermission = async () => {
      try {
        if (mounted && (await hasAvatarImagePermission())) {
          setAvatarIssue((current) =>
            current === 'permission' ? null : current,
          );
        }
      } catch {
        // The explicit picker action can retry without blocking the form.
      }
    };
    void refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const avatarError = avatarIssue
    ? t(
        avatarIssue === 'permission'
          ? 'profile.edit.avatarPermissionDenied'
          : avatarIssue === 'prepare'
            ? 'profile.edit.avatarPrepareError'
            : 'profile.edit.avatarLoadError',
      )
    : null;

  const chooseAvatar = async () => {
    setAvatarIssue(null);
    setIsPickingAvatar(true);
    try {
      const avatar = await pickAndPrepareAvatarImage();
      if (avatar) {
        setSelectedAvatar(avatar);
        setAvatarRemoved(false);
      }
    } catch (pickerError) {
      setAvatarIssue(
        pickerError instanceof Error &&
          pickerError.message === 'PHOTO_PERMISSION_DENIED'
          ? 'permission'
          : 'prepare',
      );
    } finally {
      setIsPickingAvatar(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    let uploadedPath: string | null = null;
    let profileUpdated = false;

    try {
      if (!user || !profile) throw new Error('PROFILE_NOT_READY');
      const locale: SupportedLanguage = values.locale;
      if (selectedAvatar) {
        uploadedPath = await uploadProfileAvatar({
          avatar: selectedAvatar,
          userId: user.id,
        });
        queryClient.setQueryData(
          profileAvatarKeys.signed(user.id, uploadedPath),
          selectedAvatar.uri,
        );
      }

      const updates: ProfileUpdate = {};
      const nextDisplayName = values.displayName.trim();
      if (nextDisplayName !== profile.display_name) {
        updates.display_name = nextDisplayName;
      }
      if (locale !== profile.locale) {
        updates.locale = locale;
      }
      if (selectedAvatar) {
        updates.avatar_url = uploadedPath;
      } else if (avatarRemoved && profile.avatar_url) {
        updates.avatar_url = null;
      }

      if (Object.keys(updates).length > 0) {
        await updateProfile(updates);
      }
      profileUpdated = true;

      if (
        profile.avatar_url &&
        (selectedAvatar || avatarRemoved) &&
        profile.avatar_url !== uploadedPath
      ) {
        await removeProfileAvatar(profile.avatar_url).catch(() => undefined);
      }
      await i18n.changeLanguage(locale);
      await onSaved();
    } catch {
      if (uploadedPath && !profileUpdated) {
        queryClient.removeQueries({
          exact: true,
          queryKey: profileAvatarKeys.signed(user?.id, uploadedPath),
        });
        await removeProfileAvatar(uploadedPath).catch(() => undefined);
      }
      setSubmitError(t('profile.edit.saveError'));
    }
  });

  if (isLoading) return <LoadingView label={t('profile.loading')} />;

  if (error && !profile) {
    return (
      <View style={styles.form}>
        <FormMessage message={t('profile.loadError')} />
        <AppButton
          label={t('common.retry')}
          onPress={() => void refetch()}
          variant="secondary"
        />
        {secondaryLabel && onSecondaryAction ? (
          <AppButton
            label={secondaryLabel}
            onPress={onSecondaryAction}
            variant="ghost"
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.form}>
      {submitError ? <FormMessage message={submitError} /> : null}
      <View style={styles.avatarSection}>
        <AppText variant="subheadline">{t('profile.edit.avatarTitle')}</AppText>
        <Avatar
          accessibilityLabel={
            avatarName
              ? t('profile.avatarWithName', { name: avatarName })
              : t('profile.avatar')
          }
          name={avatarName}
          onError={() => setAvatarIssue('load')}
          size={112}
          source={
            selectedAvatar
              ? { uri: selectedAvatar.uri }
              : !avatarRemoved && avatarQuery.data
                ? { uri: avatarQuery.data }
                : undefined
          }
        />
        {avatarQuery.isLoading && !selectedAvatar && !avatarRemoved ? (
          <AppText tone="secondary" variant="footnote">
            {t('profile.edit.avatarLoading')}
          </AppText>
        ) : null}
        {avatarQuery.isError && !selectedAvatar && !avatarRemoved ? (
          <View style={styles.avatarLoadError}>
            <FormMessage message={t('profile.edit.avatarLoadError')} />
            <AppButton
              label={t('common.retry')}
              onPress={() => {
                setAvatarIssue(null);
                void avatarQuery.refetch();
              }}
              variant="ghost"
            />
          </View>
        ) : null}
        {avatarError ? <FormMessage message={avatarError} /> : null}
        <View style={styles.avatarActions}>
          <AppButton
            label={
              selectedAvatar || (!avatarRemoved && profile?.avatar_url)
                ? t('profile.edit.changePhoto')
                : (emptyAvatarActionLabel ?? t('profile.edit.changePhoto'))
            }
            loading={isPickingAvatar}
            onPress={() => void chooseAvatar()}
            style={styles.avatarAction}
            variant="secondary"
          />
          {selectedAvatar || (!avatarRemoved && profile?.avatar_url) ? (
            <AppButton
              label={t('profile.edit.removePhoto')}
              onPress={() => {
                setSelectedAvatar(null);
                setAvatarRemoved(true);
                setAvatarIssue(null);
              }}
              style={styles.avatarAction}
              variant="ghost"
            />
          ) : null}
        </View>
        {avatarIssue === 'permission' ? (
          <AppButton
            label={t('profile.edit.openSettings')}
            onPress={() => void Linking.openSettings()}
            variant="ghost"
          />
        ) : null}
      </View>
      <Controller
        control={control}
        name="displayName"
        render={({ field, fieldState }) => (
          <AuthField
            autoCapitalize="words"
            error={fieldState.error?.message}
            label={nicknameLabel ?? t('auth.fields.displayName')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            returnKeyType="done"
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="locale"
        render={({ field }) => (
          <View style={styles.languageSection}>
            <AppText variant="subheadline">{t('profile.language')}</AppText>
            <View accessibilityRole="radiogroup" style={styles.languageControl}>
              <LanguageOption
                active={field.value === 'zh-HK'}
                label={t('profile.zhHK')}
                onPress={() => field.onChange('zh-HK')}
              />
              <LanguageOption
                active={field.value === 'en'}
                label={t('profile.english')}
                onPress={() => field.onChange('en')}
              />
            </View>
          </View>
        )}
      />
      <AppButton
        disabled={isPickingAvatar}
        label={primaryLabel}
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
      {secondaryLabel && onSecondaryAction ? (
        <AppButton
          disabled={isPickingAvatar || isSubmitting}
          label={secondaryLabel}
          onPress={onSecondaryAction}
          variant="ghost"
        />
      ) : null}
    </View>
  );
}

function LanguageOption({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.languageOption,
        active && styles.languageOptionActive,
        pressed && styles.pressed,
      ]}
    >
      <AppText tone={active ? 'onPrimary' : 'secondary'} variant="subheadline">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.xl },
  avatarSection: { alignItems: 'center', gap: spacing.md },
  avatarActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  avatarLoadError: { alignItems: 'center', gap: spacing.xs },
  avatarAction: { flex: 1, paddingHorizontal: spacing.md },
  languageSection: { gap: spacing.sm },
  languageControl: {
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.full,
    flexDirection: 'row',
    padding: spacing.xs,
  },
  languageOption: {
    minHeight: 44,
    alignItems: 'center',
    borderRadius: radius.full,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  languageOptionActive: { backgroundColor: lightColors.primary },
  pressed: { opacity: 0.58 },
});
