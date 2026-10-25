import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';
import {
  familyPlusIdentity,
  type FamilyPlusSnapshot,
} from '../family-plus-presentation';
import { canUseFamilyPlusPreview } from '../family-plus-preview';

export function FamilyPlusBadge({
  snapshot,
}: {
  snapshot: FamilyPlusSnapshot | null;
}) {
  const { t } = useTranslation();
  const previewAllowed = canUseFamilyPlusPreview(
    __DEV__,
    process.env.EXPO_PUBLIC_HOMEYPAW_TARGET === 'sandbox'
      ? undefined
      : process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
  if (!snapshot || !familyPlusIdentity(snapshot, previewAllowed).showBadge)
    return null;
  const preview = snapshot.source === 'development-preview';
  return (
    <View
      accessible
      accessibilityLabel={t(
        preview ? 'familyPlus.badge.previewLabel' : 'familyPlus.badge.label',
      )}
      style={styles.badge}
    >
      <Ionicons
        accessible={false}
        name="paw-outline"
        size={13}
        color={lightColors.primaryPressed}
      />
      <AppText variant="caption" style={styles.text}>
        {t(preview ? 'familyPlus.badge.previewText' : 'familyPlus.badge.text')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    maxWidth: '100%',
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: lightColors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  text: { color: lightColors.primaryPressed, flexShrink: 1 },
});
