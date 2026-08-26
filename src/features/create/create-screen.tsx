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
import { careTypes, careTypeIcons } from '@/features/care/care-types';
import { useCurrentPet } from '@/features/pets/use-current-pet';
import { lightColors, radius, shadows, spacing } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export default function CreateScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const petsState = useCurrentPet();
  const [visible, setVisible] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setVisible(true);
    }, []),
  );

  const close = () => {
    setVisible(false);
    router.replace('/');
  };
  const open = (href: Href) => {
    setVisible(false);
    router.push(href);
  };

  return (
    <Screen>
      <Modal
        animationType="slide"
        onRequestClose={close}
        transparent
        visible={visible}
      >
        <Pressable
          accessibilityRole="button"
          onPress={close}
          style={styles.overlay}
        >
          <SafeAreaView edges={['bottom']} style={styles.sheetSafeArea}>
            <Pressable
              onPress={(event) => event.stopPropagation()}
              style={styles.sheet}
            >
              <View style={styles.handle} />
              <View style={styles.headingRow}>
                <View style={styles.headingCopy}>
                  <AppText accessibilityRole="header" variant="title1">
                    {t('care.quick.title')}
                  </AppText>
                  <AppText tone="secondary" variant="footnote">
                    {petsState.currentPet
                      ? t('care.quick.subtitle', {
                          name: petsState.currentPet.name,
                        })
                      : t('care.empty.noPetBody')}
                  </AppText>
                </View>
                <Pressable
                  accessibilityLabel={t('common.close')}
                  accessibilityRole="button"
                  onPress={close}
                  style={styles.close}
                >
                  <Ionicons
                    color={lightColors.textSecondary}
                    name="close"
                    size={24}
                  />
                </Pressable>
              </View>

              {petsState.currentPet ? (
                <ScrollView
                  contentContainerStyle={styles.options}
                  showsVerticalScrollIndicator={false}
                >
                  {mode !== 'care' ? (
                    <QuickOption
                      icon="images-outline"
                      label={t('care.quick.journal')}
                      onPress={() => open('/posts/new')}
                      primary
                    />
                  ) : null}
                  {careTypes.map((careType) => (
                    <QuickOption
                      icon={careTypeIcons[careType]}
                      key={careType}
                      label={t(`care.types.${careType}`)}
                      onPress={() =>
                        open({
                          pathname: '/care/new',
                          params: { type: careType },
                        })
                      }
                    />
                  ))}
                </ScrollView>
              ) : (
                <QuickOption
                  icon="paw-outline"
                  label={t('pets.empty.action')}
                  onPress={() => open('/pets/new')}
                  primary
                />
              )}
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function QuickOption({
  icon,
  label,
  onPress,
  primary = false,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        primary && styles.primaryOption,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.optionIcon, primary && styles.primaryIcon]}>
        <Ionicons
          color={primary ? lightColors.onPrimary : lightColors.secondary}
          name={icon}
          size={24}
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
  handle: {
    width: 38,
    height: 5,
    alignSelf: 'center',
    backgroundColor: lightColors.border,
    borderRadius: radius.full,
  },
  headingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: lightColors.surfaceSecondary,
  },
  options: { gap: spacing.xs },
  option: {
    minHeight: 54,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  primaryOption: { backgroundColor: lightColors.primarySoft },
  optionIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: lightColors.secondarySoft,
  },
  primaryIcon: { backgroundColor: lightColors.primary },
  optionLabel: { flex: 1 },
  pressed: { opacity: 0.62 },
});
