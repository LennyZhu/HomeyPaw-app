import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Share, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { useFeedback } from '@/components/feedback-provider';
import { Avatar } from '@/components/avatar';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { useAuth } from '@/features/auth/auth-context';
import { usePet } from '@/features/pets/pet-queries';
import { lightColors, radius, spacing } from '@/theme';

import {
  useActivePetInvite,
  useCreatePetInvite,
  usePetMembers,
  useRemovePetMember,
  useRevokePetInvite,
} from './family-queries';

export default function PetMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { showFeedback } = useFeedback();
  const { user } = useAuth();
  const petQuery = usePet(id);
  const membersQuery = usePetMembers(id);
  const members = membersQuery.data ?? [];
  const currentMembership = members.find(
    (member) => member.userId === user?.id,
  );
  const isOwner = currentMembership?.role === 'owner';
  const activeInviteQuery = useActivePetInvite(id, isOwner);
  const createInvite = useCreatePetInvite(id);
  const revokeInvite = useRevokePetInvite(id);
  const removeMember = useRemovePetMember(id);
  const [screenOpenedAt] = useState(() => Date.now());
  const [visibleCode, setVisibleCode] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const inviteState = useMemo(() => {
    const invite = activeInviteQuery.data;
    if (!invite) {
      return null;
    }

    if (new Date(invite.expires_at).getTime() <= screenOpenedAt) {
      return 'expired' as const;
    }

    if (invite.used_count >= invite.max_uses) {
      return 'fullyUsed' as const;
    }

    return 'active' as const;
  }, [activeInviteQuery.data, screenOpenedAt]);

  const handleCreateInvite = async () => {
    setActionError(null);
    try {
      const invite = await createInvite.mutateAsync();
      setVisibleCode(invite.code);
    } catch {
      setActionError(t('family.errors.createInvite'));
    }
  };

  const handleRevokeInvite = async () => {
    const perform = async () => {
      setActionError(null);
      try {
        await revokeInvite.mutateAsync();
        setVisibleCode(null);
      } catch {
        setActionError(t('family.errors.revokeInvite'));
      }
    };

    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('family.invite.revokeConfirm'))) {
        await perform();
      }
      return;
    }

    Alert.alert(
      t('family.invite.revokeTitle'),
      t('family.invite.revokeConfirm'),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          onPress: () => void perform(),
          style: 'destructive',
          text: t('family.invite.revoke'),
        },
      ],
    );
  };

  const handleRemoveMember = (memberUserId: string, displayName: string) => {
    const perform = async () => {
      setActionError(null);
      try {
        await removeMember.mutateAsync(memberUserId);
      } catch {
        setActionError(t('family.errors.removeMember'));
      }
    };

    if (Platform.OS === 'web') {
      if (
        globalThis.confirm(
          t('family.members.removeConfirm', { name: displayName }),
        )
      ) {
        void perform();
      }
      return;
    }

    Alert.alert(
      t('family.members.removeTitle', { name: displayName }),
      t('family.members.removeConfirm', { name: displayName }),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          onPress: () => void perform(),
          style: 'destructive',
          text: t('family.members.remove'),
        },
      ],
    );
  };

  if (petQuery.isPending || membersQuery.isPending) {
    return <LoadingView label={t('family.members.loading')} />;
  }

  if (!petQuery.data || membersQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('family.errors.loadMembers')}</AppText>
        <AppButton
          label={t('common.back')}
          onPress={() => router.replace(`/pets/${id}`)}
          variant="secondary"
        />
      </Screen>
    );
  }

  const pet = petQuery.data;
  const invite = activeInviteQuery.data;
  const formattedExpiration = invite
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(invite.expires_at))
    : null;

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.topBar}>
        <IconButton
          accessibilityLabel={t('common.back')}
          icon="chevron-back"
          onPress={() => router.replace(`/pets/${pet.id}`)}
        />
      </View>

      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('family.members.title')}
        </AppText>
        <AppText tone="secondary">
          {t('family.members.subtitle', {
            count: members.length,
            name: pet.name,
          })}
        </AppText>
      </View>

      <View style={styles.memberList}>
        {members.map((member) => (
          <View key={member.userId} style={styles.memberRow}>
            <Avatar
              accessibilityLabel={t('family.members.avatar', {
                name: member.displayName,
              })}
              name={member.displayName}
              size={52}
            />
            <View style={styles.memberCopy}>
              <AppText variant="headline">{member.displayName}</AppText>
              <AppText tone="secondary" variant="subheadline">
                {t(`family.roles.${member.role}`)}
              </AppText>
            </View>
            {isOwner && member.role === 'member' ? (
              <AppButton
                disabled={removeMember.isPending}
                label={t('family.members.remove')}
                onPress={() =>
                  handleRemoveMember(member.userId, member.displayName)
                }
                style={styles.compactButton}
                variant="ghost"
              />
            ) : null}
          </View>
        ))}
      </View>

      {isOwner ? (
        <View style={styles.inviteCard}>
          <View style={styles.inviteHeading}>
            <Ionicons
              color={lightColors.primary}
              name="people-outline"
              size={24}
            />
            <View style={styles.inviteHeadingCopy}>
              <AppText variant="title3">
                {t('family.invite.title', { name: pet.name })}
              </AppText>
              <AppText tone="secondary" variant="subheadline">
                {t('family.invite.fixedRules')}
              </AppText>
            </View>
          </View>

          {activeInviteQuery.isPending ? (
            <LoadingView label={t('family.invite.loading')} />
          ) : null}

          {invite ? (
            <View style={styles.inviteDetails}>
              {visibleCode ? (
                <View style={styles.codeBlock}>
                  <AppText tone="secondary" variant="caption">
                    {t('family.invite.codeLabel')}
                  </AppText>
                  <AppText selectable style={styles.code} variant="largeTitle">
                    {visibleCode}
                  </AppText>
                </View>
              ) : (
                <AppText tone="secondary">
                  {t('family.invite.codeHidden')}
                </AppText>
              )}

              <AppText tone="secondary" variant="footnote">
                {inviteState === 'active'
                  ? t('family.invite.activeDetails', {
                      expiresAt: formattedExpiration,
                      maxUses: invite.max_uses,
                      usedCount: invite.used_count,
                    })
                  : t(`family.invite.${inviteState}`)}
              </AppText>

              {visibleCode ? (
                <View style={styles.buttonRow}>
                  <AppButton
                    label={t('family.invite.copy')}
                    onPress={() => {
                      void Clipboard.setStringAsync(visibleCode).then(() => {
                        showFeedback(t('family.invite.copiedBody'));
                      });
                    }}
                    style={styles.rowButton}
                    variant="secondary"
                  />
                  <AppButton
                    label={t('family.invite.share')}
                    onPress={() => {
                      void Share.share({
                        message: t('family.invite.shareMessage', {
                          code: visibleCode,
                          name: pet.name,
                        }),
                      });
                    }}
                    style={styles.rowButton}
                    variant="secondary"
                  />
                </View>
              ) : null}

              <View style={styles.buttonRow}>
                <AppButton
                  label={t('family.invite.regenerate')}
                  loading={createInvite.isPending}
                  onPress={() => void handleCreateInvite()}
                  style={styles.rowButton}
                  variant="secondary"
                />
                <AppButton
                  label={t('family.invite.revoke')}
                  loading={revokeInvite.isPending}
                  onPress={() => void handleRevokeInvite()}
                  style={styles.rowButton}
                  variant="danger"
                />
              </View>
            </View>
          ) : (
            <AppButton
              label={t('family.invite.create')}
              loading={createInvite.isPending}
              onPress={() => void handleCreateInvite()}
            />
          )}
        </View>
      ) : null}

      {actionError ? <AppText tone="error">{actionError}</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.huge,
    paddingTop: spacing.md,
  },
  topBar: {
    alignItems: 'flex-start',
  },
  heading: {
    gap: spacing.xs,
  },
  memberList: {
    backgroundColor: lightColors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  memberRow: {
    minHeight: 78,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  memberCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  compactButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  inviteCard: {
    backgroundColor: lightColors.primarySoft,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  inviteHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  inviteHeadingCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  inviteDetails: {
    gap: spacing.lg,
  },
  codeBlock: {
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  code: {
    letterSpacing: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowButton: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
});
