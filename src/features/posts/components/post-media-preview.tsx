import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';
import type { PostMedia } from '@/types/database';

type PostMediaPreviewProps = {
  media: PostMedia[];
  mediaUrls: Record<string, string>;
  onImageError?: () => void;
};

export function PostMediaPreview({
  media,
  mediaUrls,
  onImageError,
}: PostMediaPreviewProps) {
  const { t } = useTranslation();
  const visible = media.slice(0, 4);

  if (visible.length === 0) {
    return null;
  }

  const renderImage = (item: PostMedia, index: number, style: object) => (
    <View key={item.id} style={[styles.imageWrap, style]}>
      <Image
        accessibilityLabel={t('posts.photos.entryPhoto', {
          position: index + 1,
        })}
        accessibilityRole="image"
        cachePolicy="memory-disk"
        contentFit={visible.length === 1 ? 'contain' : 'cover'}
        recyclingKey={item.id}
        source={mediaUrls[item.storage_path] ?? null}
        style={styles.image}
        transition={160}
        {...(onImageError ? { onError: onImageError } : {})}
      />
      {index === 3 && media.length > 4 ? (
        <View
          accessibilityLabel={t('journal.morePhotos', {
            count: media.length - 4,
          })}
          accessibilityRole="text"
          style={styles.moreOverlay}
        >
          <AppText tone="onPrimary" variant="title2">
            +{media.length - 4}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  if (visible.length === 1) {
    const item = visible[0]!;
    const sourceRatio = item.width / Math.max(item.height, 1);
    const aspectRatio = Math.min(1.7, Math.max(0.76, sourceRatio));
    return (
      <View style={styles.singleOuter}>
        {renderImage(item, 0, [styles.single, { aspectRatio }])}
      </View>
    );
  }

  if (visible.length === 2) {
    return (
      <View style={styles.row}>
        {visible.map((item, index) => renderImage(item, index, styles.square))}
      </View>
    );
  }

  if (visible.length === 3) {
    const first = visible[0]!;
    const second = visible[1]!;
    const third = visible[2]!;
    return (
      <View style={styles.threeGrid}>
        {renderImage(first, 0, styles.threeLarge)}
        <View style={styles.threeColumn}>
          {renderImage(second, 1, styles.threeSmall)}
          {renderImage(third, 2, styles.threeSmall)}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fourGrid}>
      {visible.map((item, index) => renderImage(item, index, styles.quarter))}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    height: '100%',
    width: '100%',
  },
  imageWrap: {
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  singleOuter: {
    alignItems: 'center',
    maxHeight: 420,
    overflow: 'hidden',
  },
  single: { maxHeight: 420, width: '100%' },
  row: { flexDirection: 'row', gap: spacing.xs },
  square: { aspectRatio: 1, flex: 1 },
  threeGrid: { aspectRatio: 1.45, flexDirection: 'row', gap: spacing.xs },
  threeLarge: { flex: 2 },
  threeColumn: { flex: 1, gap: spacing.xs },
  threeSmall: { flex: 1 },
  fourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  quarter: { aspectRatio: 1, width: '49.3%' },
  moreOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
    backgroundColor: lightColors.overlay,
    justifyContent: 'center',
  },
});
