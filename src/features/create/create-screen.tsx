import { contentStyles } from '@/components/content-container';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type Href,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';
import {
  careTypes,
  careTypeIcons,
  healthObservationTypes,
} from '@/features/care/care-types';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { lightColors, radius, shadows, spacing } from '@/theme';

import { primaryCreateActions } from './create-menu-model';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type CreateMenu = 'care' | 'root';

export default function CreateScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const petsState = useCurrentPet();
  const [visible, setVisible] = useState(true);
  const [activeMenu, setActiveMenu] = useState<CreateMenu>(() =>
    mode === 'care' ? 'care' : 'root',
  );

  useFocusEffect(
    useCallback(() => {
      setVisible(true);
      setActiveMenu(mode === 'care' ? 'care' : 'root');
    }, [mode]),
  );

  const close = () => {
    setVisible(false);
    router.replace('/');
  };
  const open = (href: Href) => {
    setVisible(false);
    router.replace('/');
    requestAnimationFrame(() => router.push(href));
  };

  return (
    <Screen>
      <Modal
        animationType="slide"
        onRequestClose={close}
        transparent
        visible={visible}
      >
        <Pressable accessible={false} onPress={close} style={styles.overlay}>
          <SafeAreaView edges={['bottom']} style={styles.sheetSafeArea}>
            <Pressable
              accessibilityViewIsModal
              accessible={false}
              onPress={(event) => event.stopPropagation()}
              style={[styles.sheet, activeMenu === 'care' && styles.careSheet]}
            >
              <View style={styles.handle} />
              <View style={styles.headingRow}>
                {activeMenu === 'care' ? (
                  <Pressable
                    accessibilityLabel={t('common.back')}
                    accessibilityRole="button"
                    onPress={() => setActiveMenu('root')}
                    style={styles.headerAction}
                  >
                    <Ionicons
                      color={lightColors.textSecondary}
                      name="chevron-back"
                      size={24}
                    />
                  </Pressable>
                ) : null}
                <AppText
                  accessibilityRole="header"
                  style={styles.headingTitle}
                  variant="title1"
                >
                  {activeMenu === 'care'
                    ? t('create.menu.care')
                    : t('create.menu.title')}
                </AppText>
                <Pressable
                  accessibilityLabel={t('common.close')}
                  accessibilityRole="button"
                  onPress={close}
                  style={styles.headerAction}
                >
                  <Ionicons
                    color={lightColors.textSecondary}
                    name="close"
                    size={24}
                  />
                </Pressable>
              </View>

              {activeMenu === 'care' && petsState.currentPet ? (
                <ScrollView
                  contentContainerStyle={[styles.options, styles.careOptions]}
                  showsVerticalScrollIndicator={false}
                >
                  <AppText
                    style={[styles.sectionLabel, styles.careSectionLabel]}
                    tone="secondary"
                    variant="footnote"
                  >
                    {t('care.quick.dailyCare')}
                  </AppText>
                  {careTypes.map((careType) => (
                    <QuickOption
                      icon={careTypeIcons[careType]}
                      key={careType}
                      label={t(`care.types.${careType}`)}
                      compact
                      onPress={() =>
                        open({
                          pathname: '/care/new',
                          params: { type: careType },
                        })
                      }
                    />
                  ))}
                  <AppText
                    style={[styles.sectionLabel, styles.careSectionLabel]}
                    tone="secondary"
                    variant="footnote"
                  >
                    {t('care.health.title')}
                  </AppText>
                  {healthObservationTypes.map((subtype) => (
                    <QuickOption
                      icon="heart-outline"
                      key={subtype}
                      label={t(`care.health.subtypes.${subtype}`)}
                      compact
                      onPress={() =>
                        open({
                          pathname: '/care/new',
                          params: { subtype, type: 'health' },
                        })
                      }
                    />
                  ))}
                </ScrollView>
              ) : activeMenu === 'care' ? (
                <QuickOption
                  icon="paw-outline"
                  label={t('pets.empty.action')}
                  onPress={() => open('/pets/new')}
                  primary
                />
              ) : (
                <View style={styles.options}>
                  {primaryCreateActions.map((action) => (
                    <QuickOption
                      icon={action.icon}
                      key={action.id}
                      label={t(action.labelKey)}
                      onPress={() => open(action.destination.href)}
                      primary={action.id === 'journal'}
                    />
                  ))}
                </View>
              )}
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function QuickOption({
  compact = false,
  icon,
  label,
  onPress,
  primary = false,
}: {
  compact?: boolean;
  icon: IoniconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        compact && styles.compactOption,
        primary && styles.primaryOption,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.optionIcon,
          compact && styles.compactOptionIcon,
          primary && styles.primaryIcon,
        ]}
      >
        <Ionicons
          color={primary ? lightColors.onPrimary : lightColors.secondary}
          name={icon}
          size={compact ? 20 : 24}
        />
      </View>
      <AppText style={styles.optionLabel} variant="headline">
        {label}
      </AppText>
      <Ionicons
        color={lightColors.textTertiary}
        name="chevron-forward"
        size={18}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: lightColors.overlay,
  },
  sheetSafeArea: {
    ...contentStyles.modal,
    backgroundColor: lightColors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  sheet: {
    maxHeight: '92%',
    gap: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    ...shadows.floating,
  },
  careSheet: {
    gap: spacing.sm,
    minHeight: 540,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 38,
    height: 5,
    alignSelf: 'center',
    backgroundColor: lightColors.border,
    borderRadius: radius.full,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headingTitle: { flex: 1 },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: lightColors.surfaceSecondary,
  },
  options: { gap: spacing.xs },
  careOptions: { gap: 0 },
  sectionLabel: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  careSectionLabel: { marginTop: spacing.xs },
  option: {
    minHeight: 56,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  compactOption: { minHeight: 44 },
  primaryOption: { backgroundColor: lightColors.primarySoft },
  optionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: lightColors.secondarySoft,
  },
  compactOptionIcon: { width: 32, height: 32 },
  primaryIcon: { backgroundColor: lightColors.primary },
  optionLabel: { flex: 1 },
  pressed: { opacity: 0.62 },
});
