import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { EmptyState } from '@/components/empty-state';
import { LoadingView } from '@/components/loading-view';
import { Screen } from '@/components/screen';
import { PetAvatar } from '@/features/pets/components/pet-avatar';
import { PetSwitcherModal } from '@/features/pets/components/pet-switcher-modal';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { lightColors, radius, spacing } from '@/theme';

export default function ChatScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const petsState = useCurrentPet();
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const pet = petsState.currentPet;

  if (petsState.isPending) {
    return <LoadingView label={t('pets.loading.list')} />;
  }

  return (
    <Screen contentContainerStyle={styles.content} scroll>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="largeTitle">
          {t('chat.title')}
        </AppText>
        <AppText tone="secondary" variant="subheadline">
          {t('chat.subtitle')}
        </AppText>
      </View>

      {!pet ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            actionLabel={t('pets.empty.action')}
            body={t('chat.noPetBody')}
            icon="chatbubble-ellipses-outline"
            onActionPress={() => router.push('/pets/new')}
            title={t('chat.noPetTitle')}
          />
          <AppButton
            label={t('family.join.action')}
            onPress={() => router.push('/join-family' as Href)}
            variant="secondary"
          />
        </View>
      ) : (
        <>
          <Pressable
            accessibilityLabel={t('home.changePet')}
            accessibilityRole="button"
            onPress={() => setIsSwitcherOpen(true)}
            style={({ pressed }) => [
              styles.petSelector,
              pressed && styles.pressed,
            ]}
          >
            <PetAvatar
              accessibilityLabel={t('pets.avatar.accessibility', {
                name: pet.name,
              })}
              avatarPath={pet.avatar_path}
              name={pet.name}
              size={52}
            />
            <View style={styles.petCopy}>
              <AppText variant="headline">{pet.name}</AppText>
              <AppText tone="secondary" variant="footnote">
                {t('chat.petFamily')}
              </AppText>
            </View>
            <Ionicons
              color={lightColors.textSecondary}
              name="chevron-down"
              size={18}
            />
          </Pressable>

          <View style={styles.placeholder}>
            <View style={styles.iconWrap}>
              <Ionicons
                color={lightColors.secondary}
                name="chatbubbles-outline"
                size={34}
              />
            </View>
            <AppText style={styles.center} variant="title2">
              {t('chat.comingTitle')}
            </AppText>
            <AppText style={styles.center} tone="secondary">
              {t('chat.comingBody', { name: pet.name })}
            </AppText>
            <View style={styles.privateNote}>
              <Ionicons
                color={lightColors.secondary}
                name="lock-closed-outline"
                size={18}
              />
              <AppText
                style={styles.privateCopy}
                tone="secondary"
                variant="footnote"
              >
                {t('chat.privateNote')}
              </AppText>
            </View>
          </View>

          <PetSwitcherModal
            currentPetId={petsState.currentPetId}
            onAddPet={() => {
              setIsSwitcherOpen(false);
              router.push('/pets/new');
            }}
            onClose={() => setIsSwitcherOpen(false)}
            onSelectPet={(petId) => {
              petsState.setCurrentPetId(petId);
              setIsSwitcherOpen(false);
            }}
            pets={petsState.pets}
            visible={isSwitcherOpen}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge, paddingTop: spacing.md },
  heading: { gap: spacing.xs },
  emptyWrap: { flex: 1, gap: spacing.lg, minHeight: 460 },
  petSelector: {
    minHeight: 76,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xxxl,
    padding: spacing.md,
  },
  petCopy: { flex: 1, gap: spacing.xs },
  placeholder: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: 72,
  },
  iconWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  center: { textAlign: 'center' },
  privateNote: {
    alignItems: 'center',
    backgroundColor: lightColors.secondarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  privateCopy: { flex: 1 },
  pressed: { opacity: 0.65 },
});
