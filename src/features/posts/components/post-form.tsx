import Ionicons from '@expo/vector-icons/Ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Pressable,
  Linking,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { PetDateField } from '@/features/pets/components/pet-date-field';
import { lightColors, radius, spacing, typography } from '@/theme';

import {
  maximumPostMedia,
  pickPostPhotos,
  type PostMediaDraft,
} from '../post-media';
import type { PublishProgress } from '../post-publishing';
import {
  createPostFormSchema,
  postTags,
  type PostFormValues,
} from '../post-schema';

type PostFormProps = {
  initialMedia?: PostMediaDraft[];
  initialValues: PostFormValues;
  onSubmit: (values: PostFormValues, media: PostMediaDraft[]) => Promise<void>;
  submitLabel: string;
  progress?: PublishProgress | null;
  submitError?: string | null;
};

const emptyInitialMedia: PostMediaDraft[] = [];

export function PostForm({
  initialMedia = emptyInitialMedia,
  initialValues,
  onSubmit,
  progress,
  submitError,
  submitLabel,
}: PostFormProps) {
  const { t } = useTranslation();
  const schema = useMemo(() => createPostFormSchema(t), [t]);
  const [media, setMedia] = useState(initialMedia);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [permissionNotice, setPermissionNotice] = useState<string | null>(null);
  const [showPhotoSettings, setShowPhotoSettings] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<PostFormValues>({
    defaultValues: initialValues,
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    reset(initialValues);
  }, [initialValues, reset]);

  const selectPhotos = async () => {
    setIsPicking(true);
    setMediaError(null);
    setPermissionNotice(null);
    setShowPhotoSettings(false);

    try {
      const result = await pickPostPhotos(maximumPostMedia - media.length);
      setMedia((current) => [...current, ...result.photos]);

      if (result.accessPrivileges === 'limited') {
        setPermissionNotice(t('posts.photos.limitedPermission'));
        setShowPhotoSettings(true);
      }
    } catch (error) {
      const permissionDenied =
        error instanceof Error && error.message === 'PHOTO_PERMISSION_DENIED';
      setMediaError(
        permissionDenied
          ? t('posts.photos.permissionDenied')
          : t('posts.photos.selectionError'),
      );
      setShowPhotoSettings(permissionDenied);
    } finally {
      setIsPicking(false);
    }
  };

  const moveMedia = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;

    if (nextIndex < 0 || nextIndex >= media.length) {
      return;
    }

    setMedia((current) => {
      const next = [...current];
      const selected = next[index];
      const adjacent = next[nextIndex];

      if (!selected || !adjacent) {
        return current;
      }

      next[index] = adjacent;
      next[nextIndex] = selected;
      return next;
    });
  };

  const submit = handleSubmit(async (values) => {
    if (!values.content.trim() && media.length === 0) {
      setMediaError(t('posts.validation.contentOrPhoto'));
      return;
    }

    setMediaError(null);
    await onSubmit(values, media);
  });
  const isBusy = isSubmitting || isPicking;

  return (
    <View style={styles.form}>
      {submitError ? <AppText tone="error">{submitError}</AppText> : null}

      <View style={styles.field}>
        <View style={styles.photoHeader}>
          <AppText variant="subheadline">{t('posts.fields.photos')}</AppText>
          <AppText tone="tertiary" variant="footnote">
            {t('posts.photos.count', {
              count: media.length,
              maximum: maximumPostMedia,
            })}
          </AppText>
        </View>

        {media.length > 0 ? (
          <View style={styles.photoGrid}>
            {media.map((item, index) => (
              <View key={item.id} style={styles.photoTile}>
                <Image
                  accessibilityLabel={t('posts.photos.preview', {
                    position: index + 1,
                  })}
                  cachePolicy={item.kind === 'new' ? 'none' : 'disk'}
                  contentFit="cover"
                  recyclingKey={item.id}
                  source={item.uri}
                  style={styles.photo}
                />
                <View style={styles.photoPosition}>
                  <AppText tone="onPrimary" variant="caption">
                    {index + 1}
                  </AppText>
                </View>
                <View style={styles.photoActions}>
                  <PhotoAction
                    disabled={index === 0 || isBusy}
                    icon="chevron-back"
                    label={t('posts.photos.moveEarlier')}
                    onPress={() => moveMedia(index, -1)}
                  />
                  <PhotoAction
                    disabled={index === media.length - 1 || isBusy}
                    icon="chevron-forward"
                    label={t('posts.photos.moveLater')}
                    onPress={() => moveMedia(index, 1)}
                  />
                  <PhotoAction
                    disabled={isBusy}
                    icon="trash-outline"
                    label={t('posts.photos.remove')}
                    onPress={() =>
                      setMedia((current) =>
                        current.filter((candidate) => candidate.id !== item.id),
                      )
                    }
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {media.length < maximumPostMedia ? (
          <AppButton
            disabled={isSubmitting}
            label={t('posts.photos.choose')}
            loading={isPicking}
            onPress={() => void selectPhotos()}
            variant="secondary"
          />
        ) : null}
        {permissionNotice ? (
          <AppText tone="warning" variant="footnote">
            {permissionNotice}
          </AppText>
        ) : null}
        {mediaError ? (
          <AppText tone="error" variant="footnote">
            {mediaError}
          </AppText>
        ) : null}
        {showPhotoSettings ? (
          <AppButton
            label={t('posts.photos.openSettings')}
            onPress={() => void Linking.openSettings()}
            variant="ghost"
          />
        ) : null}
      </View>

      <Controller
        control={control}
        name="content"
        render={({ field, fieldState }) => (
          <PostTextField
            error={fieldState.error?.message}
            label={t('posts.fields.content')}
            maxLength={4000}
            multiline
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder={t('posts.form.contentPlaceholder')}
            style={styles.contentInput}
            textAlignVertical="top"
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="eventDate"
        render={({ field, fieldState }) => (
          <PetDateField
            error={fieldState.error?.message}
            label={t('posts.fields.eventDate')}
            onChange={field.onChange}
            value={field.value}
          />
        )}
      />

      <Controller
        control={control}
        name="tag"
        render={({ field }) => (
          <View style={styles.field}>
            <AppText variant="subheadline">{t('posts.fields.tag')}</AppText>
            <View accessibilityRole="radiogroup" style={styles.tagGroup}>
              {postTags.map((tag) => {
                const selected = field.value === tag;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={tag}
                    onPress={() => field.onChange(selected ? null : tag)}
                    style={({ pressed }) => [
                      styles.tag,
                      selected && styles.tagSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <AppText tone={selected ? 'onPrimary' : 'secondary'}>
                      {t(`posts.tags.${tag}`)}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      />

      <Controller
        control={control}
        name="locationName"
        render={({ field, fieldState }) => (
          <PostTextField
            error={fieldState.error?.message}
            label={t('posts.fields.location')}
            maxLength={160}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            placeholder={t('posts.form.locationPlaceholder')}
            value={field.value}
          />
        )}
      />

      {progress ? (
        <AppText accessibilityLiveRegion="polite" tone="secondary">
          {progress.stage === 'saving'
            ? t('posts.progress.saving')
            : t(`posts.progress.${progress.stage}`, {
                completed: progress.completed,
                total: progress.total,
              })}
        </AppText>
      ) : null}

      <AppButton
        label={submitLabel}
        loading={isSubmitting}
        onPress={() => void submit()}
      />
    </View>
  );
}

function PhotoAction({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.photoAction,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={lightColors.textPrimary} name={icon} size={18} />
    </Pressable>
  );
}

type PostTextFieldProps = TextInputProps & {
  label: string;
  error?: string | undefined;
};

function PostTextField({ label, error, style, ...props }: PostTextFieldProps) {
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

const styles = StyleSheet.create({
  form: {
    gap: spacing.xl,
  },
  field: {
    gap: spacing.sm,
  },
  photoHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photoTile: {
    width: '48.5%',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
  },
  photoPosition: {
    position: 'absolute',
    left: spacing.sm,
    top: spacing.sm,
    width: 24,
    height: 24,
    alignItems: 'center',
    backgroundColor: lightColors.overlay,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  photoActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: spacing.xs,
  },
  photoAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.3,
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
  contentInput: {
    minHeight: 140,
  },
  tagGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tag: {
    minHeight: 42,
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.full,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  tagSelected: {
    backgroundColor: lightColors.primary,
  },
  pressed: {
    opacity: 0.62,
  },
});
