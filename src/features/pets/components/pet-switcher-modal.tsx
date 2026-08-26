import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { lightColors, spacing } from '@/theme';
import type { Pet } from '@/types/database';

import { PetAvatar } from './pet-avatar';

type PetSwitcherModalProps = {
  currentPetId: string | null;
  onAddPet: () => void;
  onClose: () => void;
  onSelectPet: (petId: string) => void;
  pets: Pet[];
  visible: boolean;
};

export function PetSwitcherModal({
  currentPetId,
  onAddPet,
  onClose,
  onSelectPet,
  pets,
  visible,
}: PetSwitcherModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      transparent={false}
      visible={visible}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <AppText accessibilityRole="header" variant="title2">
            {t('pets.switcher.title')}
          </AppText>
          <IconButton
            accessibilityLabel={t('common.close')}
            icon="close"
            onPress={onClose}
          />
        </View>
        <View style={styles.list}>
          {pets.map((pet) => {
            const selected = pet.id === currentPetId;

            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={pet.id}
                onPress={() => onSelectPet(pet.id)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <PetAvatar
                  accessibilityLabel={t('pets.avatar.accessibility', {
                    name: pet.name,
                  })}
                  avatarPath={pet.avatar_path}
                  name={pet.name}
                  size={52}
                />
                <AppText style={styles.name} variant="headline">
                  {pet.name}
                </AppText>
                {selected ? (
                  <Ionicons
                    color={lightColors.success}
                    name="checkmark-circle"
                    size={24}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <AppButton
          icon={<Ionicons color={lightColors.onPrimary} name="add" size={20} />}
          label={t('pets.switcher.add')}
          onPress={onAddPet}
          style={styles.addButton}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightColors.background,
    padding: spacing.xl,
    paddingTop: spacing.xxxl,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  list: {
    marginTop: spacing.xl,
  },
  row: {
    minHeight: 72,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
  },
  name: {
    flex: 1,
  },
  addButton: {
    marginTop: spacing.xxl,
  },
  pressed: {
    opacity: 0.62,
  },
});
