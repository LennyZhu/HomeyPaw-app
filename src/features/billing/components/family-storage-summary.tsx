import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';
import {
  formatStorageBytes,
  storagePresentation,
  type FamilyPlusSnapshot,
} from '../family-plus-presentation';

export function FamilyStorageSummary({
  snapshot,
}: {
  snapshot: FamilyPlusSnapshot;
}) {
  const { t, i18n } = useTranslation();
  const format = (bytes: number) =>
    formatStorageBytes(bytes, i18n.resolvedLanguage ?? 'zh-HK');
  const storage = snapshot.storage;
  const usage = storage
    ? storagePresentation(storage.usedBytes, storage.limitBytes)
    : null;
  return (
    <View style={styles.section}>
      <AppText accessibilityRole="header" variant="title3">
        {t('familyPlus.storage.title')}
      </AppText>
      {storage && usage ? (
        <>
          <View style={styles.line}>
            <AppText tone="secondary" variant="subheadline">
              {t('familyPlus.storage.used')}
            </AppText>
            <AppText variant="headline">
              {format(storage.usedBytes)} / {format(storage.limitBytes)}
            </AppText>
          </View>
          <View
            accessibilityLabel={t('familyPlus.storage.title')}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: usage.percent }}
            style={styles.track}
          >
            <View
              style={[
                styles.fill,
                { width: `${usage.percent}%` },
                usage.overBytes > 0 && styles.over,
              ]}
            />
          </View>
          <AppText tone="secondary" variant="footnote">
            {usage.overBytes > 0
              ? t('familyPlus.storage.over', {
                  amount: format(usage.overBytes),
                })
              : t('familyPlus.storage.remaining', {
                  amount: format(usage.remainingBytes),
                })}
          </AppText>
          {usage.overBytes > 0 ? (
            <AppText tone="secondary" variant="footnote">
              {t('familyPlus.storage.retained')}
            </AppText>
          ) : null}
        </>
      ) : (
        <AppText tone="secondary" variant="subheadline">
          {t('familyPlus.storage.noData')}
        </AppText>
      )}
      {snapshot.videos ? (
        <View style={styles.video}>
          <AppText variant="subheadline">
            {t('familyPlus.storage.videosUsed', {
              count: snapshot.videos.uploaded,
            })}
          </AppText>
          <AppText tone="secondary" variant="footnote">
            {snapshot.videos.limit === null
              ? t('familyPlus.storage.unlimited')
              : t('familyPlus.storage.videosRemaining', {
                  count: Math.max(
                    0,
                    snapshot.videos.limit - snapshot.videos.uploaded,
                  ),
                })}
          </AppText>
        </View>
      ) : null}
      {snapshot.usageDetails ? (
        <>
          {snapshot.usageDetails.status !== 'ready' ? (
            <AppText tone="secondary" variant="footnote">
              {t('familyPlus.meteringPending')}
            </AppText>
          ) : null}
          {(
            [
              'reservedBytes',
              'unpublishedBytes',
              'cleanupPendingBytes',
            ] as const
          ).map((key) => {
            const amount = snapshot.usageDetails?.[key];
            return amount ? (
              <AppText key={key} tone="secondary" variant="footnote">
                {t(`familyPlus.usage.${key}`, { amount: format(amount) })}
              </AppText>
            ) : null;
          })}
          {snapshot.usageDetails.videoStatus !== 'ready' ? (
            <AppText tone="secondary" variant="footnote">
              {t('familyPlus.videoPolicyPending')}
            </AppText>
          ) : (
            <AppText tone="secondary" variant="footnote">
              {t('familyPlus.videoPolicyCandidate')}
            </AppText>
          )}
        </>
      ) : null}
      {snapshot.source === 'development-preview' ||
      snapshot.quotaEnabled === false ? (
        <AppText tone="secondary" variant="footnote">
          {t('familyPlus.storage.enforcementOff')}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  track: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: lightColors.surfaceSecondary,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: lightColors.secondary },
  over: { backgroundColor: lightColors.warning },
  video: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: lightColors.border,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
});
