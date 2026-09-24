import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import { IconButton } from '@/components/icon-button';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { SettingsRow } from '@/components/settings-row';
import { useAuth } from '@/features/auth/auth-context';
import { createStorageImageSource } from '@/features/media/storage-signed-url';
import { profileAvatarBucket } from '@/features/profile/profile-avatar';
import { lightColors, radius, spacing } from '@/theme';

import { clearRevokedFamilyAccess } from './family-access-cleanup';
import { familyLabel } from './family-label';
import { familyMemberLimit } from './family-member-limit';
import {
  deleteFamily,
  useFamilyMemberSummaries,
  useFamilyPets,
  useLeaveFamily,
  useRemoveFamilyMember,
  useTransferFamilyOwnership,
} from './family-queries';
import { useCurrentFamily } from './use-current-family';

export default function FamilySettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const context = useCurrentFamily();
  const membersQuery = useFamilyMemberSummaries(id);
  const familyPetsQuery = useFamilyPets(id);
  const leave = useLeaveFamily();
  const transfer = useTransferFamilyOwnership(id);
  const remove = useRemoveFamilyMember(id);
  const [deleting, setDeleting] = useState(false);
  const [webDeleteStep, setWebDeleteStep] = useState<0 | 1 | 2>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeMemberMenu, setActiveMemberMenu] = useState<string | null>(null);
  const familyAccess = context.families.find(
    (access) => access.family.id === id,
  );
  const role = familyAccess?.membership.role;
  const isOwner = role === 'owner';
  const pets = familyPetsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const busy =
    deleting || leave.isPending || transfer.isPending || remove.isPending;
  const name = familyAccess
    ? familyLabel(familyAccess.family, context.pets, t)
    : '';
  const { refetch: refetchFamilies } = context.familiesQuery;
  const { refetch: refetchPets } = context.petsQuery;
  const { refetch: refetchMembers } = membersQuery;
  const { refetch: refetchFamilyPets } = familyPetsQuery;

  useFocusEffect(
    useCallback(() => {
      if (context.backendCapability !== 'FAMILY_MULTI_PET') return;
      void refetchFamilies();
      void refetchPets();
      void refetchMembers();
      void refetchFamilyPets();
    }, [
      context.backendCapability,
      refetchFamilies,
      refetchPets,
      refetchMembers,
      refetchFamilyPets,
    ]),
  );

  useEffect(() => {
    if (
      context.backendCapability !== 'FAMILY_MULTI_PET' ||
      !user ||
      !context.familiesQuery.isSuccess ||
      familyAccess
    )
      return;
    clearRevokedFamilyAccess({
      familyId: id,
      queryClient,
      setCurrentFamilyId: context.setCurrentFamilyId,
      setCurrentPetId: context.setCurrentPetId,
      userId: user.id,
    });
    router.replace('/families');
  }, [
    context.backendCapability,
    context.familiesQuery.isSuccess,
    familyAccess,
    id,
    queryClient,
    router,
    user,
    context.setCurrentFamilyId,
    context.setCurrentPetId,
  ]);

  const reconcileAfterExit = () => {
    if (!user) return;
    clearRevokedFamilyAccess({
      familyId: id,
      queryClient,
      setCurrentFamilyId: context.setCurrentFamilyId,
      setCurrentPetId: context.setCurrentPetId,
      userId: user.id,
    });
    router.replace('/families');
  };

  const confirmAction = (
    title: string,
    body: string,
    label: string,
    action: () => void,
  ) => {
    if (busy) return;
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`${title}\n\n${body}`)) action();
      return;
    }
    Alert.alert(title, body, [
      { style: 'cancel', text: t('common.cancel') },
      { style: 'destructive', text: label, onPress: action },
    ]);
  };

  const doTransfer = (memberUserId: string) => {
    setActionError(null);
    void transfer.mutateAsync(memberUserId).catch(() => {
      setActionError(t('family.lifecycle.transferError'));
      void context.familiesQuery.refetch();
      void membersQuery.refetch();
    });
  };
  const doRemove = (memberUserId: string) => {
    setActionError(null);
    void remove.mutateAsync(memberUserId).catch(() => {
      setActionError(t('family.lifecycle.removeError'));
      void context.familiesQuery.refetch();
      void membersQuery.refetch();
    });
  };
  const doLeave = () => {
    setActionError(null);
    void leave
      .mutateAsync(id)
      .then(reconcileAfterExit)
      .catch(() => {
        setActionError(t('family.lifecycle.leaveError'));
        void context.familiesQuery.refetch();
      });
  };
  const doDelete = async () => {
    if (deleting || !isOwner) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteFamily(id);
      reconcileAfterExit();
    } catch {
      setActionError(t('family.lifecycle.deleteError'));
      void context.familiesQuery.refetch();
      void membersQuery.refetch();
    } finally {
      setDeleting(false);
      setWebDeleteStep(0);
    }
  };
  const confirmDelete = () => {
    if (Platform.OS === 'web') {
      setWebDeleteStep(1);
      return;
    }
    Alert.alert(
      t('family.lifecycle.deleteTitle', { name }),
      t('family.lifecycle.deleteBody', { name }),
      [
        { style: 'cancel', text: t('common.cancel') },
        {
          text: t('common.continue'),
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              t('family.lifecycle.finalDeleteTitle'),
              t('family.lifecycle.finalDeleteBody', { name }),
              [
                { style: 'cancel', text: t('common.cancel') },
                {
                  style: 'destructive',
                  text: t('family.lifecycle.deleteAction'),
                  onPress: () => void doDelete(),
                },
              ],
            ),
        },
      ],
    );
  };

  if (
    context.capabilityQuery.isPending ||
    context.petsQuery.isPending ||
    (context.backendCapability === 'FAMILY_MULTI_PET' &&
      context.familiesQuery.isPending)
  ) {
    return <LoadingView label={t('family.lifecycle.loading')} />;
  }
  if (context.backendCapability === 'LEGACY_PET') {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('profile.manageFamilies')}
        </AppText>
        <AppText tone="secondary">{t('family.bridge.legacyNotice')}</AppText>
        <AppButton
          label={t('profile.myPets')}
          onPress={() => router.replace('/pets')}
          variant="secondary"
        />
      </Screen>
    );
  }

  if (!familyAccess || context.familiesQuery.isError) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <AppText tone="error">{t('family.lifecycle.unavailable')}</AppText>
        <AppButton
          label={t('common.back')}
          onPress={() => router.replace('/families')}
          variant="secondary"
        />
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('family.lifecycle.manage')}
        </AppText>
      </View>

      <View style={styles.section}>
        <AppText variant="title3">{t('family.lifecycle.infoTitle')}</AppText>
        <View style={[styles.card, styles.infoCard]}>
          <AppText variant="headline">{name}</AppText>
          <AppText tone="secondary" variant="footnote">
            {t(`family.roles.${role}`)} ·{' '}
            {t('family.lifecycle.petCount', {
              count: context.pets.filter((pet) => pet.family_id === id).length,
            })}
          </AppText>
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="title3">{t('family.members.title')}</AppText>
        <View style={styles.card}>
          {membersQuery.isPending ? (
            <LoadingView label={t('family.members.loading')} />
          ) : null}
          {membersQuery.isError ? (
            <AppText tone="error">{t('family.errors.loadMembers')}</AppText>
          ) : null}
          {members.map((member) => (
            <View key={member.userId}>
              <View style={styles.memberRow}>
                <Avatar
                  name={member.displayName}
                  size={44}
                  accessibilityLabel={t('family.members.avatar', {
                    name: member.displayName,
                  })}
                  source={createStorageImageSource(
                    profileAvatarBucket,
                    member.avatarPath ?? '',
                    member.avatarUrl,
                  )}
                />
                <View style={styles.memberCopy}>
                  <AppText variant="headline">{member.displayName}</AppText>
                  <AppText tone="secondary" variant="subheadline">
                    {t(`family.roles.${member.role}`)}
                  </AppText>
                </View>
                {isOwner &&
                member.userId !== user?.id &&
                (member.role === 'member' || member.role === 'viewer') ? (
                  <IconButton
                    accessibilityLabel={t('family.lifecycle.memberActions', {
                      name: member.displayName,
                    })}
                    icon="ellipsis-horizontal"
                    onPress={() =>
                      setActiveMemberMenu(
                        activeMemberMenu === member.userId
                          ? null
                          : member.userId,
                      )
                    }
                    style={styles.memberActionButton}
                  />
                ) : null}
              </View>
              {isOwner &&
              activeMemberMenu === member.userId &&
              member.userId !== user?.id &&
              (member.role === 'member' || member.role === 'viewer') ? (
                <View style={styles.memberActionMenu}>
                  {member.role === 'member' ? (
                    <SettingsRow
                      disabled={busy}
                      icon="swap-horizontal-outline"
                      label={t('family.lifecycle.transferAction')}
                      onPress={() => {
                        setActiveMemberMenu(null);
                        confirmAction(
                          t('family.lifecycle.transferTitle', {
                            name: member.displayName,
                          }),
                          t('family.lifecycle.transferBody', {
                            name: member.displayName,
                          }),
                          t('family.lifecycle.transferAction'),
                          () => doTransfer(member.userId),
                        );
                      }}
                    />
                  ) : null}
                  <SettingsRow
                    danger
                    disabled={busy}
                    icon="person-remove-outline"
                    label={t('family.members.remove')}
                    last
                    onPress={() => {
                      setActiveMemberMenu(null);
                      confirmAction(
                        t('family.lifecycle.removeTitle', {
                          name: member.displayName,
                        }),
                        t('family.lifecycle.removeBody', {
                          name: member.displayName,
                          role: t(`family.roles.${member.role}`),
                        }),
                        t('family.members.remove'),
                        () => doRemove(member.userId),
                      );
                    }}
                  />
                </View>
              ) : null}
            </View>
          ))}
          {pets[0] ? (
            <SettingsRow
              icon="mail-outline"
              label={t('family.lifecycle.manageInvites')}
              last
              onPress={() => router.push(`/pets/${pets[0]?.id}/members`)}
              subtitle={
                isOwner
                  ? t('family.invite.fixedRules', {
                      maximum: familyMemberLimit,
                    })
                  : undefined
              }
            />
          ) : (
            <AppText
              style={styles.cardNote}
              tone="secondary"
              variant="subheadline"
            >
              {t('family.lifecycle.invitesNeedPet')}
            </AppText>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="title3">{t('family.lifecycle.petsTitle')}</AppText>
        <View style={styles.card}>
          {familyPetsQuery.isPending ? (
            <LoadingView label={t('pets.loading.list')} />
          ) : null}
          {familyPetsQuery.isError ? (
            <AppText tone="error">{t('pets.errors.load')}</AppText>
          ) : null}
          {pets.length === 0 && familyPetsQuery.isSuccess ? (
            <AppText
              style={styles.cardNote}
              tone="secondary"
              variant="subheadline"
            >
              {t('family.lifecycle.zeroPets')}
            </AppText>
          ) : null}
          {pets.map((pet) => (
            <SettingsRow
              key={pet.id}
              icon="paw-outline"
              label={pet.name}
              onPress={() => router.push(`/pets/${pet.id}`)}
            />
          ))}
          {isOwner ? (
            <SettingsRow
              icon="add-circle-outline"
              label={t('pets.list.addPet')}
              last
              onPress={() => {
                context.setCurrentFamilyId(id);
                router.push('/pets/new');
              }}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="title3">
          {t('family.lifecycle.managementTitle')}
        </AppText>
        <View style={styles.card}>
          {isOwner ? (
            <AppText
              style={styles.cardNote}
              tone="secondary"
              variant="footnote"
            >
              {t('family.lifecycle.ownerLeaveGuidance')}
            </AppText>
          ) : (
            <SettingsRow
              busy={leave.isPending}
              danger
              disabled={busy}
              icon="exit-outline"
              label={t('family.lifecycle.leaveAction')}
              last
              onPress={() =>
                confirmAction(
                  t('family.lifecycle.leaveTitle', { name }),
                  t('family.lifecycle.leaveBody', { name }),
                  t('family.lifecycle.leaveAction'),
                  doLeave,
                )
              }
            />
          )}
        </View>
      </View>

      {isOwner ? (
        <View style={styles.dangerZone}>
          <AppText tone="error" variant="footnote">
            {t('accountSecurity.dangerZone')}
          </AppText>
          {webDeleteStep > 0 ? (
            <View style={styles.confirmation}>
              <AppText variant="headline">
                {webDeleteStep === 1
                  ? t('family.lifecycle.deleteTitle', { name })
                  : t('family.lifecycle.finalDeleteTitle')}
              </AppText>
              <AppText tone="secondary">
                {webDeleteStep === 1
                  ? t('family.lifecycle.deleteBody', { name })
                  : t('family.lifecycle.finalDeleteBody', { name })}
              </AppText>
              <View style={styles.confirmationActions}>
                <AppButton
                  disabled={busy}
                  label={t('common.cancel')}
                  onPress={() => setWebDeleteStep(0)}
                  variant="ghost"
                />
                <SettingsRow
                  danger={webDeleteStep === 2}
                  disabled={busy}
                  busy={deleting}
                  label={
                    webDeleteStep === 1
                      ? t('common.continue')
                      : t('family.lifecycle.deleteAction')
                  }
                  last
                  onPress={() =>
                    webDeleteStep === 1 ? setWebDeleteStep(2) : void doDelete()
                  }
                />
              </View>
            </View>
          ) : (
            <SettingsRow
              danger
              disabled={busy}
              icon="trash-outline"
              label={t('family.lifecycle.deleteAction')}
              last
              onPress={confirmDelete}
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
  heading: { gap: spacing.xs, paddingBottom: spacing.sm },
  section: { gap: spacing.sm },
  card: {
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  infoCard: { paddingVertical: spacing.xs },
  cardNote: { paddingVertical: spacing.md },
  memberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.md,
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  memberActionButton: { backgroundColor: lightColors.surface },
  memberActionMenu: {
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  dangerZone: {
    gap: spacing.sm,
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  confirmation: { gap: spacing.md, paddingBottom: spacing.md },
  confirmationActions: { gap: spacing.xs },
});
