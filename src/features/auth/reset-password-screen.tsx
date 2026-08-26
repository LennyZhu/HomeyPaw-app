import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { requireSupabase } from '@/lib/supabase/client';

import { getAuthErrorMessage } from './auth-errors';
import {
  createPasswordResetSchema,
  type PasswordResetValues,
} from './auth-schemas';
import { useAuth } from './auth-context';
import { AuthField } from './components/auth-field';
import { AuthScreen } from './components/auth-screen';
import { FormMessage } from './components/form-message';

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const confirmRef = useRef<TextInput>(null);
  const {
    completePasswordRecovery,
    isPasswordRecovery,
    isProcessingAuthCallback,
    session,
    signOut,
  } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const schema = useMemo(() => createPasswordResetSchema(t), [t]);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<PasswordResetValues>({
    defaultValues: { confirmPassword: '', password: '' },
    resolver: zodResolver(schema),
  });
  const linkReady = Boolean(
    isPasswordRecovery && session && !isProcessingAuthCallback,
  );

  const leaveRecovery = async () => {
    if (isPasswordRecovery) {
      await signOut().catch(() => undefined);
      router.replace('/sign-in');
    } else if (session) {
      router.replace('/');
    } else {
      completePasswordRecovery();
      router.replace('/sign-in');
    }
  };

  const onSubmit = handleSubmit(async ({ password }) => {
    if (!linkReady) {
      setSubmitError(t('auth.resetPassword.invalidLink'));
      return;
    }

    setSubmitError(null);
    try {
      const { error } = await requireSupabase().auth.updateUser({ password });
      if (error) {
        throw error;
      }

      await signOut();
      router.replace({
        pathname: '/sign-in',
        params: { passwordReset: 'success' },
      });
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error, t));
    }
  });

  return (
    <AuthScreen
      subtitle={t('auth.resetPassword.subtitle')}
      title={t('auth.resetPassword.title')}
    >
      {isProcessingAuthCallback ? (
        <AppText tone="secondary">{t('auth.resetPassword.preparing')}</AppText>
      ) : !linkReady ? (
        <FormMessage message={t('auth.resetPassword.invalidLink')} />
      ) : null}
      {submitError ? <FormMessage message={submitError} /> : null}
      {linkReady ? (
        <>
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
                onSubmitEditing={() => confirmRef.current?.focus()}
                placeholder={t('auth.fields.passwordCreatePlaceholder')}
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
                ref={confirmRef}
                returnKeyType="done"
                secureTextEntry
                secureToggleLabel={t('auth.fields.togglePassword')}
                textContentType="newPassword"
                value={field.value}
              />
            )}
          />
          <AppButton
            label={t('auth.resetPassword.submit')}
            loading={isSubmitting}
            onPress={() => void onSubmit()}
          />
        </>
      ) : null}
      <AppButton
        label={t('auth.checkEmail.backToSignIn')}
        onPress={() => void leaveRecovery()}
        variant="ghost"
      />
    </AuthScreen>
  );
}
