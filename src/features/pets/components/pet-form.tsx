import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing, typography } from '@/theme';
import type { PetGender, PetSpecies } from '@/types/database';

import { pickAndPreparePetAvatar, type PreparedPetAvatar } from '../pet-avatar';
import {
  createPetFormSchema,
  defaultPetFormValues,
  type PetFormValues,
} from '../pet-schema';
import { PetAvatar } from './pet-avatar';
import { PetDateField } from './pet-date-field';

export type PetAvatarChange =
  | { type: 'keep' }
  | { type: 'remove' }
  | { avatar: PreparedPetAvatar; type: 'replace' };

type PetFormProps = {
  onSubmit: (
    values: PetFormValues,
    avatarChange: PetAvatarChange,
  ) => Promise<void>;
  submitLabel: string;
  avatarPath?: string | null;
  initialValues?: PetFormValues;
  submitError?: string | null;
};

const speciesOptions: PetSpecies[] = ['dog', 'cat', 'other'];
const genderOptions: PetGender[] = ['male', 'female', 'unknown'];

export function PetForm({
  onSubmit,
  submitLabel,
  avatarPath = null,
  initialValues = defaultPetFormValues,
  submitError,
}: PetFormProps) {
  const { t } = useTranslation();
  const schema = useMemo(() => createPetFormSchema(t), [t]);
  const [selectedAvatar, setSelectedAvatar] =
    useState<PreparedPetAvatar | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [showPhotoSettings, setShowPhotoSettings] = useState(false);
  const [isPickingAvatar, setIsPickingAvatar] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<PetFormValues>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
  });
  const petName = useWatch({ control, name: 'name' });

  useEffect(() => {
    reset(initialValues);
  }, [initialValues, reset]);

  const selectAvatar = async () => {
    setAvatarError(null);
    setShowPhotoSettings(false);
    setIsPickingAvatar(true);

    try {
      const avatar = await pickAndPreparePetAvatar();

      if (avatar) {
        setSelectedAvatar(avatar);
        setAvatarRemoved(false);
      }
    } catch (error) {
      const permissionDenied =
        error instanceof Error && error.message === 'PHOTO_PERMISSION_DENIED';
      setAvatarError(
        permissionDenied
          ? t('pets.avatar.permissionDenied')
          : t('pets.avatar.prepareError'),
      );
      setShowPhotoSettings(permissionDenied);
    } finally {
      setIsPickingAvatar(false);
    }
  };

  const submit = handleSubmit(async (values) => {
    const avatarChange: PetAvatarChange = selectedAvatar
      ? { avatar: selectedAvatar, type: 'replace' }
      : avatarRemoved
        ? { type: 'remove' }
        : { type: 'keep' };

    await onSubmit(values, avatarChange);
  });

  return (
    <View style={styles.form}>
      {submitError ? <AppText tone="error">{submitError}</AppText> : null}

      <View style={styles.avatarSection}>
        <PetAvatar
          accessibilityLabel={t('pets.avatar.accessibility', {
            name: petName || t('pets.form.unnamedPet'),
          })}
          avatarPath={avatarRemoved ? null : avatarPath}
          localUri={selectedAvatar?.uri}
          name={petName}
          size={112}
        />
        <View style={styles.avatarActions}>
          <AppButton
            label={t('pets.avatar.choose')}
            loading={isPickingAvatar}
            onPress={() => void selectAvatar()}
            variant="secondary"
          />
          {selectedAvatar || (avatarPath && !avatarRemoved) ? (
            <AppButton
              label={t('pets.avatar.remove')}
              onPress={() => {
                setSelectedAvatar(null);
                setAvatarRemoved(true);
              }}
              variant="ghost"
            />
          ) : null}
        </View>
        {avatarError ? (
          <AppText tone="error" variant="footnote">
            {avatarError}
          </AppText>
        ) : null}
        {showPhotoSettings ? (
          <AppButton
            label={t('pets.avatar.openSettings')}
            onPress={() => void Linking.openSettings()}
            variant="ghost"
          />
        ) : null}
      </View>

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <PetTextField
            error={fieldState.error?.message}
            label={t('pets.fields.name')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder={t('pets.form.namePlaceholder')}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="species"
        render={({ field }) => (
          <ChoiceGroup
            label={t('pets.fields.species')}
            onChange={field.onChange}
            options={speciesOptions}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="breed"
        render={({ field, fieldState }) => (
          <PetTextField
            error={fieldState.error?.message}
            label={t('pets.fields.breed')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder={t('pets.form.optionalPlaceholder')}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="gender"
        render={({ field }) => (
          <ChoiceGroup
            label={t('pets.fields.gender')}
            onChange={field.onChange}
            options={genderOptions}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="birthday"
        render={({ field, fieldState }) => (
          <PetDateField
            error={fieldState.error?.message}
            label={t('pets.fields.birthday')}
            onChange={field.onChange}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="adoptionDate"
        render={({ field, fieldState }) => (
          <PetDateField
            error={fieldState.error?.message}
            label={t('pets.fields.adoptionDate')}
            onChange={field.onChange}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="weight"
        render={({ field, fieldState }) => (
          <PetTextField
            error={fieldState.error?.message}
            keyboardType="decimal-pad"
            label={t('pets.fields.weight')}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder={t('pets.form.weightPlaceholder')}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <PetTextField
            error={fieldState.error?.message}
            label={t('pets.fields.description')}
            multiline
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder={t('pets.form.descriptionPlaceholder')}
            style={styles.descriptionInput}
            textAlignVertical="top"
            value={field.value}
          />
        )}
      />

      <AppButton
        label={submitLabel}
        loading={isSubmitting}
        onPress={() => void submit()}
      />
    </View>
  );
}

type PetTextFieldProps = TextInputProps & {
  label: string;
  error?: string | undefined;
};

function PetTextField({ label, error, style, ...props }: PetTextFieldProps) {
  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={lightColors.textTertiary}
        style={[styles.input, error && styles.inputError, style]}
        {...props}
      />
      {error ? (
        <AppText tone="error" variant="footnote">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

type ChoiceGroupProps<T extends PetGender | PetSpecies> = {
  label: string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
};

function ChoiceGroup<T extends PetGender | PetSpecies>({
  label,
  onChange,
  options,
  value,
}: ChoiceGroupProps<T>) {
  const { t } = useTranslation();

  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{label}</AppText>
      <View accessibilityRole="radiogroup" style={styles.choiceGroup}>
        {options.map((option) => {
          const active = option === value;

          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              key={option}
              onPress={() => onChange(option)}
              style={({ pressed }) => [
                styles.choice,
                active && styles.choiceActive,
                pressed && styles.pressed,
              ]}
            >
              <AppText tone={active ? 'onPrimary' : 'secondary'}>
                {t(`pets.codes.${option}`)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.xl,
  },
  avatarSection: {
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarActions: {
    width: '100%',
    gap: spacing.sm,
  },
  field: {
    gap: spacing.sm,
  },
  input: {
    minHeight: 50,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    color: lightColors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.body,
  },
  inputError: {
    borderColor: lightColors.error,
  },
  descriptionInput: {
    minHeight: 120,
  },
  choiceGroup: {
    gap: spacing.sm,
    flexDirection: 'row',
  },
  choice: {
    minHeight: 44,
    alignItems: 'center',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.full,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  choiceActive: {
    backgroundColor: lightColors.primary,
  },
  pressed: {
    opacity: 0.62,
  },
});
