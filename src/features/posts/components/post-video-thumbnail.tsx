import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, spacing } from '@/theme';
import type { PostVideo } from '@/types/database';

export function PostVideoThumbnail({
  onImageError,
  onPress,
  thumbnailUrl,
  video,
}: {
  onImageError?: () => void;
  onPress: () => void;
  thumbnailUrl: string | null;
  video: PostVideo;
}) {
  const { t } = useTranslation();
  const aspectRatio = Math.min(
    1.78,
    Math.max(0.72, video.width / Math.max(video.height, 1)),
  );

  return (
    <Pressable
      accessibilityLabel={t('posts.video.play')}
      accessibilityRole="button"
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={({ pressed }) => [
        styles.container,
        { aspectRatio },
        pressed && styles.pressed,
      ]}
    >
      <Image
        accessibilityElementsHidden
        cachePolicy="memory-disk"
        contentFit="cover"
        recyclingKey={video.id}
        source={thumbnailUrl}
        style={styles.image}
        transition={160}
        {...(onImageError ? { onError: onImageError } : {})}
      />
      <View style={styles.play} pointerEvents="none">
        <Ionicons color={lightColors.onPrimary} name="play" size={28} />
      </View>
      <View style={styles.duration} pointerEvents="none">
        <AppText tone="onPrimary" variant="caption">
          {formatVideoDuration(video.duration_ms)}
        </AppText>
      </View>
    </Pressable>
  );
}

function formatVideoDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxHeight: 420,
    alignItems: 'center',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.md,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { height: '100%', width: '100%' },
  play: {
    position: 'absolute',
    height: 58,
    width: 58,
    alignItems: 'center',
    backgroundColor: lightColors.overlay,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  duration: {
    position: 'absolute',
    backgroundColor: lightColors.overlay,
    borderRadius: radius.sm,
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    right: spacing.sm,
  },
  pressed: { opacity: 0.78 },
});
