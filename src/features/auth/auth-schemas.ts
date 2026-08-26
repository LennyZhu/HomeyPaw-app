import type { TFunction } from 'i18next';
import { z } from 'zod';

export function createSignInSchema(t: TFunction) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t('auth.validation.emailRequired'))
      .email(t('auth.validation.emailInvalid')),
    password: z.string().min(1, t('auth.validation.passwordRequired')),
  });
}

export function createSignUpSchema(t: TFunction) {
  return z
    .object({
      displayName: z
        .string()
        .trim()
        .min(1, t('auth.validation.displayNameRequired'))
        .max(80, t('auth.validation.displayNameTooLong')),
      email: z
        .string()
        .trim()
        .min(1, t('auth.validation.emailRequired'))
        .email(t('auth.validation.emailInvalid')),
      password: z.string().min(8, t('auth.validation.passwordMinimum')),
      confirmPassword: z
        .string()
        .min(1, t('auth.validation.confirmPasswordRequired')),
    })
    .refine((value) => value.password === value.confirmPassword, {
      message: t('auth.validation.passwordMismatch'),
      path: ['confirmPassword'],
    });
}

export function createEmailSchema(t: TFunction) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t('auth.validation.emailRequired'))
      .email(t('auth.validation.emailInvalid')),
  });
}

export function createPasswordResetSchema(t: TFunction) {
  return z
    .object({
      password: z.string().min(8, t('auth.validation.passwordMinimum')),
      confirmPassword: z
        .string()
        .min(1, t('auth.validation.confirmPasswordRequired')),
    })
    .refine((value) => value.password === value.confirmPassword, {
      message: t('auth.validation.passwordMismatch'),
      path: ['confirmPassword'],
    });
}

export type SignInValues = z.infer<ReturnType<typeof createSignInSchema>>;
export type SignUpValues = z.infer<ReturnType<typeof createSignUpSchema>>;
export type EmailValues = z.infer<ReturnType<typeof createEmailSchema>>;
export type PasswordResetValues = z.infer<
  ReturnType<typeof createPasswordResetSchema>
>;
