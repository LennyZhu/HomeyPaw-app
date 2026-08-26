import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { useFeedback } from '@/components/feedback-provider';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { useCurrentPetStore } from '@/stores/current-pet-store';
import { lightColors, radius, spacing, typography } from '@/theme';

import {
  familyKeys,
  type InvitePreview,
  previewInvite,
  useJoinPet,
} from './family-queries';

function normalizeCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '')
    .slice(0, 8);
}

function isInvalidInviteError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (('message' in error &&
      (String(error.message).includes('invite_invalid') ||
        String(error.message).includes('non-2xx'))) ||
      ('name' in error && String(error.name) === 'FunctionsHttpError')),
  );
}

export default function JoinFamilyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const joinPet = useJoinPet();
  const setCurrentPetId = useCurrentPetStore((state) => state.setCurrentPetId);
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePreview = async () => {
    const normalized = normalizeCode(code);
    setErrorMessage(null);

    if (normalized.length !== 8) {
      setErrorMessage(t('family.errors.invalidInvite'));
      return;
    }

    setIsPreviewing(true);
    try {
      const result = await queryClient.fetchQuery({
        queryFn: () => previewInvite(normalized),
        queryKey: familyKeys.invitePreview(user?.id, normalized),
        staleTime: 30_000,
      });
      setSubmittedCode(normalized);
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setSubmittedCode(null);
      setErrorMessage(
        isInvalidInviteError(error)
          ? t('family.errors.invalidInvite')
          : t('family.errors.network'),
      );
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleJoin = async () => {
    if (!submittedCode || !preview) {
      return;
    }

    setErrorMessage(null);
    try {
      const result = await joinPet.mutateAsync(submittedCode);
      setCurrentPetId(result.petId);
      const message =
        result.status === 'already_member'
          ? t('family.join.alreadyMember', { name: result.petName })
          : t('family.join.joined', { name: result.petName });

      showFeedback(message);
      router.replace(`/pets/${result.petId}`);
    } catch (error) {
      setErrorMessage(
        isInvalidInviteError(error)
          ? t('family.errors.invalidInvite')
          : t('family.errors.network'),
      );
    }
  };

  return (
    <Screen
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      scroll
    >
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('family.join.title')}
        </AppText>
        <AppText tone="secondary">{t('family.join.subtitle')}</AppText>
      </View>

      <View style={styles.inputSection}>
        <AppText variant="headline">{t('family.join.codeLabel')}</AppText>
        <View style={styles.inputWrap}>
          <Ionicons
            color={lightColors.textTertiary}
            name="keypad-outline"
            size={22}
          />
          <TextInput
            accessibilityLabel={t('family.join.codeLabel')}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            onChangeText={(value) => {
              setCode(normalizeCode(value));
              setPreview(null);
              setSubmittedCode(null);
              setErrorMessage(null);
            }}
            placeholder={t('family.join.codePlaceholder')}
            placeholderTextColor={lightColors.textTertiary}
            returnKeyType="done"
            style={styles.input}
            value={code}
          />
        </View>
        {!preview ? (
          <AppButton
            disabled={code.length !== 8}
            label={t('common.continue')}
            loading={isPreviewing}
            onPress={() => void handlePreview()}
          />
        ) : null}
      </View>

      {preview ? (
        <View style={styles.previewCard}>
          <Avatar
            accessibilityLabel={t('pets.avatar.accessibility', {
              name: preview.petName,
            })}
            name={preview.petName}
            size={104}
            source={preview.avatarUrl ?? undefined}
          />
          <View style={styles.previewCopy}>
            <AppText variant="title1">{preview.petName}</AppText>
            <AppText tone="secondary" variant="headline">
              {preview.petBreed
                ? `${preview.petBreed} · ${t(`pets.codes.${preview.petSpecies}`)}`
                : t(`pets.codes.${preview.petSpecies}`)}
            </AppText>
            <AppText style={styles.inviterText} tone="secondary">
              {t('family.join.invitedBy', {
                inviter: preview.inviterDisplayName,
                name: preview.petName,
              })}
            </AppText>
          </View>
          <AppButton
            label={t('family.join.confirm')}
            loading={joinPet.isPending}
            onPress={() => void handleJoin()}
            style={styles.joinButton}
          />
        </View>
      ) : null}

      {errorMessage ? <AppText tone="error">{errorMessage}</AppText> : null}

      <AppButton
        label={t('common.cancel')}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/profile');
          }
        }}
        variant="ghost"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.huge,
    paddingTop: spacing.xl,
  },
  heading: {
    gap: spacing.sm,
  },
  inputSection: {
    gap: spacing.md,
  },
  inputWrap: {
    minHeight: 58,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  input: {
    ...typography.title2,
    flex: 1,
    color: lightColors.textPrimary,
    letterSpacing: 3,
    paddingVertical: spacing.md,
  },
  previewCard: {
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  previewCopy: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  inviterText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  joinButton: {
    alignSelf: 'stretch',
  },
});
