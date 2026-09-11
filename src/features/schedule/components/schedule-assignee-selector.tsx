import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { Avatar } from '@/components/avatar';
import {
  contentStyles,
  useContentLayout,
} from '@/components/content-container';
import { modalSupportedOrientations } from '@/config/orientation';
import type { PetMemberSummary } from '@/features/family/family-queries';
import { lightColors, radius, shadows, spacing } from '@/theme';

import {
  getScheduleAssigneeOptions,
  type ScheduleAssigneeOption,
} from '../schedule-assignee-options';

type Props = {
  currentUserId: string | undefined;
  members: PetMemberSummary[];
  onChange: (userId: string | null) => void;
  role: PetMemberSummary['role'] | null;
  selectedFallback?: {
    avatarUrl: string | null;
    displayName: string | null;
    userId: string | null;
  };
  value: string | null;
};

export function ScheduleAssigneeSelector({
  currentUserId,
  members,
  onChange,
  role,
  selectedFallback,
  value,
}: Props) {
  const { t } = useTranslation();
  const { isWide } = useContentLayout('modal');
  const [visible, setVisible] = useState(false);
  const options = useMemo(
    () => getScheduleAssigneeOptions(members, role, currentUserId),
    [currentUserId, members, role],
  );
  const selectedOption =
    options.find((option) => option.userId === value) ??
    (value && selectedFallback?.userId === value
      ? {
          avatarUrl: selectedFallback.avatarUrl,
          displayName:
            selectedFallback.displayName ?? t('schedule.form.unknownAssignee'),
          userId: value,
        }
      : null);
  const selectedName = selectedOption?.displayName ?? t('schedule.unassigned');

  return (
    <View style={styles.field}>
      <AppText variant="subheadline">{t('schedule.form.assignee')}</AppText>
      <Pressable
        accessibilityHint={t('schedule.form.assigneeHint')}
        accessibilityLabel={t('schedule.form.assigneeSelection', {
          name: selectedName,
        })}
        accessibilityRole="button"
        accessibilityState={{ expanded: visible }}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <AssigneeIdentity option={selectedOption} />
        <Ionicons
          color={lightColors.textTertiary}
          name="chevron-down"
          size={20}
        />
      </Pressable>

      <Modal
        animationType={isWide ? 'fade' : 'slide'}
        onRequestClose={() => setVisible(false)}
        supportedOrientations={modalSupportedOrientations}
        transparent
        visible={visible}
      >
        <Pressable
          accessible={false}
          onPress={() => setVisible(false)}
          style={[styles.overlay, isWide && styles.overlayWide]}
        >
          <View style={styles.safeArea}>
            <Pressable
              accessibilityViewIsModal
              accessible={false}
              onPress={(event) => event.stopPropagation()}
              style={styles.sheet}
            >
              <View style={styles.header}>
                <AppText accessibilityRole="header" variant="title2">
                  {t('schedule.form.assigneePickerTitle')}
                </AppText>
                <Pressable
                  accessibilityLabel={t('common.close')}
                  accessibilityRole="button"
                  onPress={() => setVisible(false)}
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    color={lightColors.textSecondary}
                    name="close"
                    size={22}
                  />
                </Pressable>
              </View>
              <ScrollView
                contentContainerStyle={styles.options}
                showsVerticalScrollIndicator={false}
                style={styles.optionScroll}
              >
                {options.map((option) => {
                  const selected = option.userId === value;
                  const optionName =
                    option.displayName ?? t('schedule.unassigned');
                  return (
                    <Pressable
                      accessibilityLabel={optionName}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={option.userId ?? 'unassigned'}
                      onPress={() => {
                        onChange(option.userId);
                        setVisible(false);
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.selectedOption,
                        pressed && styles.pressed,
                      ]}
                    >
                      <AssigneeIdentity option={option} />
                      {selected ? (
                        <Ionicons
                          color={lightColors.primary}
                          name="checkmark-circle"
                          size={24}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <SafeAreaView edges={isWide ? [] : ['bottom']} />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function AssigneeIdentity({
  option,
}: {
  option: ScheduleAssigneeOption | null;
}) {
  const { t } = useTranslation();

  if (!option?.userId) {
    return (
      <View style={styles.identity}>
        <View style={styles.unassignedIcon}>
          <Ionicons
            color={lightColors.textSecondary}
            name="person-outline"
            size={19}
          />
        </View>
        <AppText numberOfLines={1} style={styles.name}>
          {t('schedule.unassigned')}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.identity}>
      <Avatar
        accessibilityLabel={option.displayName}
        name={option.displayName}
        size={34}
        source={option.avatarUrl ? { uri: option.avatarUrl } : undefined}
      />
      <AppText numberOfLines={1} style={styles.name}>
        {option.displayName}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  control: {
    minHeight: 52,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  identity: {
    minWidth: 0,
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  name: { flex: 1 },
  unassignedIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: lightColors.overlay,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
  },
  overlayWide: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  safeArea: { ...contentStyles.modal },
  sheet: {
    maxHeight: '82%',
    backgroundColor: lightColors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.subtle,
  },
  header: {
    minHeight: 64,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  optionScroll: { maxHeight: 480 },
  options: {
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  option: {
    minHeight: 56,
    alignItems: 'center',
    borderBottomColor: lightColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  selectedOption: { backgroundColor: lightColors.primarySoft },
  pressed: { opacity: 0.66 },
});
