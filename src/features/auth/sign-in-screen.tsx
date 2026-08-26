import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { requireSupabase } from '@/lib/supabase/client';
import { spacing } from '@/theme';

import { getAuthErrorMessage } from './auth-errors';
import { createSignInSchema, type SignInValues } from './auth-schemas';
import { useAuth } from './auth-context';
import { AuthField } from './components/auth-field';
import { AuthScreen } from './components/auth-screen';
import { FormMessage } from './components/form-message';

export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { passwordReset } = useLocalSearchParams<{ passwordReset?: string }>();
  const { isConfigured } = useAuth();
  const passwordRef = useRef<TextInput>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const schema = useMemo(() => createSignInSchema(t), [t]);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SignInValues>({
    defaultValues: { email: '', password: '' },
    resolver: zodResolver(schema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);

    try {
      const { error } = await requireSupabase().auth.signInWithPassword({
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error, t));
    }
  });

  return (
    <AuthScreen
      footer={
        <View style={styles.footerRow}>
          <AppText tone="secondary" variant="subheadline">
            {t('auth.signIn.noAccount')}
          </AppText>
          <Link href="/sign-up" asChild>
            <AppButton
              label={t('auth.signIn.createAccount')}
              onPress={() => undefined}
              variant="ghost"
            />
          </Link>
        </View>
      }
      subtitle={t('auth.tagline')}
      title={t('auth.signIn.title')}
    >
      {!isConfigured ? (
        <FormMessage message={t('auth.errors.configuration')} />
      ) : null}
      {submitError ? <FormMessage message={submitError} /> : null}
      {passwordReset === 'success' ? (
        <FormMessage
          message={t('auth.resetPassword.successBody')}
          tone="success"
        />
      ) : null}

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
            autoComplete="current-password"
            error={fieldState.error?.message}
            label={t('auth.fields.password')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            onSubmitEditing={() => void onSubmit()}
            placeholder={t('auth.fields.passwordPlaceholder')}
            ref={passwordRef}
            returnKeyType="done"
            secureTextEntry
            secureToggleLabel={t('auth.fields.togglePassword')}
            textContentType="password"
            value={field.value}
          />
        )}
      />

      <AppButton
        disabled={!isConfigured}
        label={t('auth.signIn.submit')}
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
      <AppButton
        label={t('auth.signIn.forgotPassword')}
        onPress={() => router.push('/forgot-password')}
        variant="ghost"
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  footerRow: {
    alignItems: 'center',
    gap: spacing.xs,
  },
});
