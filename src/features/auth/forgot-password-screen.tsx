import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { requireSupabase } from '@/lib/supabase/client';

import { getAuthErrorMessage } from './auth-errors';
import { createEmailSchema, type EmailValues } from './auth-schemas';
import { useAuth } from './auth-context';
import { AuthField } from './components/auth-field';
import { AuthScreen } from './components/auth-screen';
import { FormMessage } from './components/form-message';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isConfigured } = useAuth();
  const [message, setMessage] = useState<{
    text: string;
    tone: 'error' | 'success';
  } | null>(null);
  const schema = useMemo(() => createEmailSchema(t), [t]);
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<EmailValues>({
    defaultValues: { email: '' },
    resolver: zodResolver(schema),
  });

  const onSubmit = handleSubmit(async (values) => {
    setMessage(null);

    try {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(
        values.email.trim().toLowerCase(),
        { redirectTo: Linking.createURL('reset-password') },
      );

      if (error) {
        throw error;
      }

      setMessage({ text: t('auth.forgotPassword.success'), tone: 'success' });
    } catch (error) {
      setMessage({ text: getAuthErrorMessage(error, t), tone: 'error' });
    }
  });

  return (
    <AuthScreen
      subtitle={t('auth.forgotPassword.subtitle')}
      title={t('auth.forgotPassword.title')}
    >
      {!isConfigured ? (
        <FormMessage message={t('auth.errors.configuration')} />
      ) : null}
      {message ? (
        <FormMessage message={message.text} tone={message.tone} />
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
            onSubmitEditing={() => void onSubmit()}
            placeholder={t('auth.fields.emailPlaceholder')}
            returnKeyType="done"
            textContentType="emailAddress"
            value={field.value}
          />
        )}
      />
      <AppButton
        disabled={!isConfigured}
        label={t('auth.forgotPassword.submit')}
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
      <AppButton
        label={t('common.back')}
        onPress={() => router.back()}
        variant="ghost"
      />
    </AuthScreen>
  );
}
