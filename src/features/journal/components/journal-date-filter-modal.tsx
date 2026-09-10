import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { ModalScreen } from '@/components/modal-screen';
import { useTranslation } from 'react-i18next';

import { AppButton } from '@/components/app-button';
import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { lightColors, layout, radius, spacing } from '@/theme';

import {
  getRecentJournalDateRange,
  isValidJournalDateRange,
  type JournalDateRange,
} from '../journal-browsing';
import { JournalDateField } from './journal-date-field';

type Props = {
  onApply: (range: JournalDateRange | undefined) => void;
  onClose: () => void;
  range: JournalDateRange | undefined;
  visible: boolean;
};

export function JournalDateFilterModal({
  onApply,
  onClose,
  range,
  visible,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<JournalDateRange>(
    () => range ?? getRecentJournalDateRange(30),
  );
  const isValid = isValidJournalDateRange(draft);

  const applyPreset = (days: number) => {
    onApply(getRecentJournalDateRange(days));
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <ModalScreen contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <AppText accessibilityRole="header" variant="title1">
              {t('journal.filter.title')}
            </AppText>
            <AppText tone="secondary" variant="subheadline">
              {t('journal.filter.subtitle')}
            </AppText>
          </View>
          <IconButton
            accessibilityLabel={t('common.close')}
            icon="close"
            onPress={onClose}
          />
        </View>

        <View style={styles.presets}>
          <FilterPreset
            icon="albums-outline"
            label={t('journal.filter.all')}
            onPress={() => {
              onApply(undefined);
              onClose();
            }}
          />
          <FilterPreset
            icon="calendar-outline"
            label={t('journal.filter.lastSevenDays')}
            onPress={() => applyPreset(7)}
          />
          <FilterPreset
            icon="calendar-number-outline"
            label={t('journal.filter.lastThirtyDays')}
            onPress={() => applyPreset(30)}
          />
        </View>

        <View style={styles.customSection}>
          <AppText variant="headline">{t('journal.filter.custom')}</AppText>
          <View style={styles.dateFields}>
            <JournalDateField
              label={t('journal.filter.startDate')}
              onChange={(startDate) =>
                setDraft((current) => ({ ...current, startDate }))
              }
              value={draft.startDate}
            />
            <JournalDateField
              label={t('journal.filter.endDate')}
              onChange={(endDate) =>
                setDraft((current) => ({ ...current, endDate }))
              }
              value={draft.endDate}
            />
          </View>
          {!isValid ? (
            <AppText accessibilityRole="alert" tone="error" variant="footnote">
              {t('journal.filter.invalidRange')}
            </AppText>
          ) : null}
        </View>

        <AppButton
          disabled={!isValid}
          label={t('journal.filter.apply')}
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        />
      </ModalScreen>
    </Modal>
  );
}

function FilterPreset({
  icon,
  label,
  onPress,
}: {
  icon: 'albums-outline' | 'calendar-number-outline' | 'calendar-outline';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.preset, pressed && styles.pressed]}
    >
      <Ionicons color={lightColors.secondary} name={icon} size={20} />
      <AppText variant="subheadline">{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: lightColors.background },
  content: {
    gap: spacing.xl,
    padding: layout.screenPadding,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  presets: { gap: spacing.sm },
  preset: {
    minHeight: 48,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  customSection: {
    backgroundColor: lightColors.surface,
    borderColor: lightColors.border,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  dateFields: { gap: spacing.lg },
  pressed: { opacity: 0.65 },
});
