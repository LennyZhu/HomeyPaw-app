import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { Link, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import type { SupportedLanguage } from '@/i18n';
import { requireSupabase } from '@/lib/supabase/client';

import { getAuthErrorMessage } from './auth-errors';
import { createSignUpSchema, type SignUpValues } from './auth-schemas';
import { useAuth } from './auth-context';
import { AuthField } from './components/auth-field';
import { AuthScreen } from './components/auth-screen';
import { FormMessage } from './components/form-message';

export default function SignUpScreen() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { isConfigured } = useAuth();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const schema = useMemo(() => createSignUpSchema(t), [t]);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SignUpValues>({
    defaultValues: {
      confirmPassword: '',
      displayName: '',
      email: '',
      password: '',
    },
    resolver: zodResolver(schema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const locale: SupportedLanguage = i18n.resolvedLanguage?.startsWith('en')
      ? 'en'
      : 'zh-HK';

    try {
      const { data, error } = await requireSupabase().auth.signUp({
        email: values.email.trim().toLowerCase(),
        password: values.password,
        options: {
          emailRedirectTo: Linking.createURL('check-email'),
          data: {
            display_name: values.displayName.trim(),
            locale,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        router.replace({
          pathname: '/check-email',
          params: { email: values.email.trim().toLowerCase() },
        });
      }
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error, t));
    }
  });

  return (
    <AuthScreen
      footer={
        <View>
          <AppText tone="secondary" variant="subheadline">
            {t('auth.signUp.hasAccount')}
          </AppText>
          <Link href="/sign-in" asChild>
            <AppButton
              label={t('auth.signUp.signIn')}
              onPress={() => undefined}
              variant="ghost"
            />
          </Link>
        </View>
      }
      subtitle={t('auth.signUp.subtitle')}
      title={t('auth.signUp.title')}
    >
      {!isConfigured ? (
        <FormMessage message={t('auth.errors.configuration')} />
      ) : null}
      {submitError ? <FormMessage message={submitError} /> : null}

      <Controller
        control={control}
        name="displayName"
        render={({ field, fieldState }) => (
          <AuthField
            autoCapitalize="words"
            autoComplete="name"
            error={fieldState.error?.message}
            label={t('auth.fields.displayName')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            onSubmitEditing={() => emailRef.current?.focus()}
            placeholder={t('auth.fields.displayNamePlaceholder')}
            returnKeyType="next"
            textContentType="name"
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <AuthField
            autoComplete="email"
            error={fieldState.error?.message}
            keyboardType="email-address"
            label={t('auth.fields.email')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder={t('auth.fields.emailPlaceholder')}
            ref={emailRef}
            returnKeyType="next"
            textContentType="emailAddress"
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <AuthField
            autoComplete="new-password"
            error={fieldState.error?.message}
            label={t('auth.fields.password')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            onSubmitEditing={() => confirmPasswordRef.current?.focus()}
            placeholder={t('auth.fields.passwordCreatePlaceholder')}
            ref={passwordRef}
            returnKeyType="next"
            secureTextEntry
            secureToggleLabel={t('auth.fields.togglePassword')}
            textContentType="newPassword"
            value={field.value}
          />
        )}
      />
      <Controller
        control={control}
        name="confirmPassword"
        render={({ field, fieldState }) => (
          <AuthField
            autoComplete="new-password"
            error={fieldState.error?.message}
            label={t('auth.fields.confirmPassword')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            onSubmitEditing={() => void onSubmit()}
            placeholder={t('auth.fields.confirmPasswordPlaceholder')}
            ref={confirmPasswordRef}
            returnKeyType="done"
            secureTextEntry
            secureToggleLabel={t('auth.fields.togglePassword')}
            textContentType="newPassword"
            value={field.value}
          />
        )}
      />

      <AppButton
        disabled={!isConfigured}
        label={t('auth.signUp.submit')}
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
    </AuthScreen>
  );
}
