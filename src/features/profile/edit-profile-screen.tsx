import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import type { SupportedLanguage } from '@/i18n';
import { lightColors, radius, spacing } from '@/theme';

import { AuthField } from '../auth/components/auth-field';
import { FormMessage } from '../auth/components/form-message';
import { useProfile } from './use-profile';

export default function EditProfileScreen() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { isLoading, profile, updateProfile } = useProfile();
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  useEffect(() => {
    if (profile) {
      reset({ displayName: profile.display_name, locale: profile.locale });
    }
  }, [profile, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);

    try {
      const locale: SupportedLanguage = values.locale;
      await updateProfile({
        display_name: values.displayName.trim(),
        locale,
      });
      await i18n.changeLanguage(locale);
      showFeedback(t('profile.edit.saved'));
      router.back();
    } catch {
      setSubmitError(t('profile.edit.saveError'));
    }
  });

  if (isLoading) {
    return <LoadingView label={t('profile.loading')} />;
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <AppText accessibilityRole="header" variant="largeTitle">
        {t('profile.edit.title')}
      </AppText>
      <AppText style={styles.subtitle} tone="secondary">
        {t('profile.edit.subtitle')}
      </AppText>

      <View style={styles.form}>
        {submitError ? <FormMessage message={submitError} /> : null}
        <Controller
          control={control}
          name="displayName"
          render={({ field, fieldState }) => (
            <AuthField
              autoCapitalize="words"
              error={fieldState.error?.message}
              label={t('auth.fields.displayName')}
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
              <View
                accessibilityRole="radiogroup"
                style={styles.languageControl}
              >
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
          label={t('common.save')}
          loading={isSubmitting}
          onPress={() => void onSubmit()}
        />
      </View>
    </Screen>
  );
}

type LanguageOptionProps = {
  active: boolean;
  label: string;
  onPress: () => void;
};

function LanguageOption({ active, label, onPress }: LanguageOptionProps) {
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
  content: {
    paddingTop: spacing.md,
  },
  subtitle: {
    marginTop: spacing.sm,
  },
  form: {
    gap: spacing.xl,
    marginTop: spacing.huge,
  },
  languageSection: {
    gap: spacing.sm,
  },
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
  languageOptionActive: {
    backgroundColor: lightColors.primary,
  },
  pressed: {
    opacity: 0.58,
  },
});
