import Ionicons from '@expo/vector-icons/Ionicons';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Pressable,
  Linking,
  Platform,
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
  createEditedPostMediaDraft,
  type EditedPhotoResult,
} from '../photo-editor-state';
import {
  maximumPostMedia,
  pickPostPhotos,
  type PostPhotoSource,
  type PostMediaDraft,
} from '../post-media';
import { removePostPhotoEditTemp } from '../post-photo-edit-files';
import {
  getPostPhotoAddPresentation,
  movePostPhoto,
  removePostPhoto,
} from '../post-composer-photo-state';
import type { PublishProgress } from '../post-publishing';
import {
  createPostFormSchema,
  postTags,
  type PostFormValues,
} from '../post-schema';
import {
  PostComposerActionModal,
  type PostComposerAction,
} from './post-composer-action-modal';
import { PostPhotoEditor } from './post-photo-editor';

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
  const [editorDraft, setEditorDraft] = useState<PostMediaDraft | null>(null);
  const [photoSourceMenuVisible, setPhotoSourceMenuVisible] = useState(false);
  const [photoActionsId, setPhotoActionsId] = useState<string | null>(null);
  const mediaRef = useRef(media);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoPickerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const photoEditorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    return () => {
      if (photoPickerTimerRef.current) {
        clearTimeout(photoPickerTimerRef.current);
      }
      if (photoEditorTimerRef.current) {
        clearTimeout(photoEditorTimerRef.current);
      }
      cleanupTimerRef.current = setTimeout(() => {
        for (const item of mediaRef.current) {
          if (item.kind === 'new') {
            removePostPhotoEditTemp(item.editTempUri);
          }
        }
      }, 0);
    };
  }, []);

  const selectPhotos = async (source: PostPhotoSource) => {
    setIsPicking(true);
    setMediaError(null);
    setPermissionNotice(null);
    setShowPhotoSettings(false);

    try {
      const result = await pickPostPhotos(
        source,
        maximumPostMedia - media.length,
      );
      setMedia((current) => [...current, ...result.photos]);

      if (result.accessPrivileges === 'limited') {
        setPermissionNotice(t('posts.photos.limitedPermission'));
        setShowPhotoSettings(true);
      }
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : '';
      const photoPermissionDenied = errorCode === 'PHOTO_PERMISSION_DENIED';
      const cameraPermissionDenied =
        errorCode === 'CAMERA_PERMISSION_DENIED' ||
        errorCode === 'CAMERA_PERMISSION_BLOCKED';
      setMediaError(
        photoPermissionDenied
          ? t('posts.photos.permissionDenied')
          : cameraPermissionDenied
            ? t('posts.photos.cameraPermissionDenied')
            : source === 'camera'
              ? t('posts.photos.cameraError')
              : t('posts.photos.selectionError'),
      );
      setShowPhotoSettings(photoPermissionDenied || cameraPermissionDenied);
    } finally {
      setIsPicking(false);
    }
  };

  const showPhotoSourceMenu = () => {
    setPhotoSourceMenuVisible(true);
  };

  const selectPhotoSource = (source: PostPhotoSource) => {
    setPhotoSourceMenuVisible(false);
    if (photoPickerTimerRef.current) {
      clearTimeout(photoPickerTimerRef.current);
    }
    photoPickerTimerRef.current = setTimeout(
      () => {
        photoPickerTimerRef.current = null;
        void selectPhotos(source);
      },
      Platform.OS === 'ios' ? 350 : 0,
    );
  };

  const moveMedia = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;

    if (nextIndex < 0 || nextIndex >= media.length) {
      return;
    }

    setMedia((current) => movePostPhoto(current, index, direction));
  };

  const openPhotoEditor = (item: PostMediaDraft, afterMenu = false) => {
    if (!afterMenu) {
      setEditorDraft(item);
      return;
    }
    if (photoEditorTimerRef.current) {
      clearTimeout(photoEditorTimerRef.current);
    }
    photoEditorTimerRef.current = setTimeout(
      () => {
        photoEditorTimerRef.current = null;
        setEditorDraft(item);
      },
      Platform.OS === 'ios' ? 350 : 0,
    );
  };

  const removeMedia = (item: PostMediaDraft) => {
    if (item.kind === 'new') {
      removePostPhotoEditTemp(item.editTempUri);
    }
    setMedia((current) => removePostPhoto(current, item.id));
  };

  const applyPhotoEdit = (result: EditedPhotoResult) => {
    const editedItem = editorDraft;
    if (!editedItem) return;
    if (editedItem.kind === 'new') {
      removePostPhotoEditTemp(editedItem.editTempUri);
    }

    setMedia((current) =>
      current.map((item) => {
        if (item.id !== editedItem.id) return item;
        return createEditedPostMediaDraft(item, result, Crypto.randomUUID());
      }),
    );
    setEditorDraft(null);
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
  const addPhotoPresentation = getPostPhotoAddPresentation(
    media.length,
    maximumPostMedia,
  );
  const photoActionsIndex = media.findIndex(
    (item) => item.id === photoActionsId,
  );
  const photoActionsItem =
    photoActionsIndex >= 0 ? media[photoActionsIndex] : undefined;
  const photoSourceActions: PostComposerAction[] = [
    {
      icon: 'camera-outline',
      label: t('posts.photos.takePhoto'),
      onPress: () => selectPhotoSource('camera'),
    },
    {
      icon: 'images-outline',
      label: t('posts.photos.chooseLibrary'),
      onPress: () => selectPhotoSource('library'),
    },
  ];
  const photoTileActions: PostComposerAction[] = photoActionsItem
    ? [
        {
          icon: 'create-outline',
          label: t('posts.photoEditor.edit'),
          onPress: () => openPhotoEditor(photoActionsItem, true),
        },
        ...(photoActionsIndex > 0
          ? [
              {
                icon: 'chevron-back' as const,
                label: t('posts.photos.moveEarlier'),
                onPress: () => moveMedia(photoActionsIndex, -1),
              },
            ]
          : []),
        ...(photoActionsIndex < media.length - 1
          ? [
              {
                icon: 'chevron-forward' as const,
                label: t('posts.photos.moveLater'),
                onPress: () => moveMedia(photoActionsIndex, 1),
              },
            ]
          : []),
        {
          destructive: true,
          icon: 'trash-outline',
          label: t('posts.photos.remove'),
          onPress: () => removeMedia(photoActionsItem),
        },
      ]
    : [];

  return (
    <View style={styles.form}>
      {submitError ? <AppText tone="error">{submitError}</AppText> : null}

      <View style={styles.field}>
        <View style={styles.photoHeader}>
          <AppText style={styles.photoHeaderLabel} variant="subheadline">
            {t('posts.fields.photos')}
          </AppText>
          <AppText
            accessibilityLabel={t('posts.photos.countAccessibility', {
              count: media.length,
              maximum: maximumPostMedia,
            })}
            style={styles.photoCount}
            tone="tertiary"
            variant="footnote"
          >
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
                <Pressable
                  accessibilityLabel={t('posts.photoEditor.editPosition', {
                    position: index + 1,
                  })}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isBusy }}
                  disabled={isBusy}
                  onPress={() => openPhotoEditor(item)}
                  style={({ pressed }) => [
                    styles.photoPressable,
                    pressed && styles.photoPressed,
                  ]}
                >
                  <Image
                    accessible={false}
                    cachePolicy={item.kind === 'new' ? 'none' : 'disk'}
                    contentFit="cover"
                    recyclingKey={item.id}
                    source={item.uri}
                    style={styles.photo}
                  />
                </Pressable>
                <View style={styles.photoPosition}>
                  <AppText tone="onPrimary" variant="caption">
                    {index + 1}
                  </AppText>
                </View>
                <PhotoOverlayAction
                  disabled={isBusy}
                  icon="ellipsis-horizontal"
                  label={t('posts.photos.actions', {
                    position: index + 1,
                  })}
                  onPress={() => setPhotoActionsId(item.id)}
                />
              </View>
            ))}
            {addPhotoPresentation === 'tile' ? (
              <Pressable
                accessibilityLabel={t('posts.photos.add')}
                accessibilityRole="button"
                accessibilityState={{ busy: isPicking, disabled: isBusy }}
                disabled={isBusy}
                onPress={showPhotoSourceMenu}
                style={({ pressed }) => [
                  styles.addPhotoTile,
                  pressed && styles.pressed,
                  isBusy && styles.disabled,
                ]}
              >
                {isPicking ? (
                  <ActivityIndicator color={lightColors.primary} />
                ) : (
                  <Ionicons color={lightColors.primary} name="add" size={28} />
                )}
                <AppText
                  numberOfLines={2}
                  style={styles.addPhotoLabel}
                  tone="brand"
                  variant="subheadline"
                >
                  {t('posts.photos.add')}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {addPhotoPresentation === 'button' ? (
          <AppButton
            disabled={isSubmitting}
            label={t('posts.photos.add')}
            loading={isPicking}
            onPress={showPhotoSourceMenu}
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

      <PostComposerActionModal
        actions={photoSourceActions}
        onCancel={() => setPhotoSourceMenuVisible(false)}
        title={t('posts.photos.sourceTitle')}
        visible={photoSourceMenuVisible}
      />

      {photoActionsItem ? (
        <PostComposerActionModal
          actions={photoTileActions}
          onCancel={() => setPhotoActionsId(null)}
          title={t('posts.photos.actions', {
            position: photoActionsIndex + 1,
          })}
          visible
        />
      ) : null}

      {editorDraft ? (
        <PostPhotoEditor
          draft={editorDraft}
          onCancel={() => setEditorDraft(null)}
          onDone={applyPhotoEdit}
        />
      ) : null}
    </View>
  );
}

function PhotoOverlayAction({
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
      <View style={styles.photoActionVisual}>
        <Ionicons color={lightColors.textPrimary} name={icon} size={18} />
      </View>
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
  photoHeaderLabel: { flex: 1 },
  photoCount: { flexShrink: 0, textAlign: 'right' },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photoTile: {
    width: '48.5%',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    aspectRatio: 1,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPressable: { width: '100%', height: '100%' },
  photoPressed: { opacity: 0.86 },
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
  photoAction: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    right: spacing.xs,
    top: spacing.xs,
  },
  photoActionVisual: {
    width: 30,
    height: 30,
    alignItems: 'center',
    backgroundColor: 'rgba(251, 247, 242, 0.88)',
    borderColor: lightColors.border,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  addPhotoTile: {
    width: '48.5%',
    minHeight: 44,
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: lightColors.primarySoft,
    borderColor: lightColors.primary,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
  },
  addPhotoLabel: { maxWidth: '100%', textAlign: 'center' },
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
