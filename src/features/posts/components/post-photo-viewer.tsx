import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { lightColors, layout, radius, spacing } from '@/theme';
import type { PostMedia } from '@/types/database';

import { clampPhotoViewerIndex } from '../photo-viewer-state';

type PostPhotoViewerProps = {
  hasLoadError?: boolean;
  initialIndex: number;
  isLoading?: boolean;
  media: PostMedia[];
  mediaUrls: Record<string, string>;
  onClose: () => void;
  onImageError?: () => void;
  visible: boolean;
};

export function PostPhotoViewer({
  hasLoadError = false,
  initialIndex,
  isLoading = false,
  media,
  mediaUrls,
  onClose,
  onImageError,
  visible,
}: PostPhotoViewerProps) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<PostMedia>>(null);
  const [currentIndex, setCurrentIndex] = useState(() =>
    clampPhotoViewerIndex(initialIndex, media.length),
  );

  useEffect(() => {
    if (!visible || media.length === 0) return;
    const nextIndex = clampPhotoViewerIndex(initialIndex, media.length);
    const frame = requestAnimationFrame(() => {
      setCurrentIndex(nextIndex);
      listRef.current?.scrollToIndex({ animated: false, index: nextIndex });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialIndex, media.length, visible]);

  if (!visible) return null;

  const goToIndex = (index: number) => {
    const nextIndex = clampPhotoViewerIndex(index, media.length);
    setCurrentIndex(nextIndex);
    listRef.current?.scrollToIndex({ animated: true, index: nextIndex });
  };
  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setCurrentIndex(
      clampPhotoViewerIndex(
        Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1)),
        media.length,
      ),
    );
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView
        accessibilityViewIsModal
        edges={['top', 'bottom']}
        style={styles.viewer}
      >
        <StatusBar style="light" />
        <IconButton
          accessibilityLabel={t('common.close')}
          color={lightColors.onPrimary}
          icon="close"
          onPress={onClose}
          style={styles.closeButton}
        />

        <FlatList
          data={media}
          decelerationRate="fast"
          extraData={mediaUrls}
          getItemLayout={(_, index) => ({
            index,
            length: width,
            offset: width * index,
          })}
          horizontal
          initialScrollIndex={clampPhotoViewerIndex(initialIndex, media.length)}
          keyExtractor={(item) => item.id}
          onMomentumScrollEnd={handleScrollEnd}
          pagingEnabled
          ref={listRef}
          renderItem={({ item, index }) => (
            <ZoomablePostPhoto
              key={`${item.id}-${mediaUrls[item.storage_path] ?? 'pending'}`}
              hasLoadError={hasLoadError}
              index={index}
              isLoading={isLoading}
              item={item}
              onImageError={onImageError}
              total={media.length}
              uri={mediaUrls[item.storage_path]}
              width={width}
            />
          )}
          showsHorizontalScrollIndicator={false}
          style={styles.pages}
        />

        {media.length > 0 ? (
          <View style={styles.controls}>
            <ViewerNavigationButton
              disabled={currentIndex === 0}
              icon="chevron-back"
              label={t('posts.photos.previous')}
              onPress={() => goToIndex(currentIndex - 1)}
            />
            <AppText
              accessibilityLabel={t('posts.photos.viewerPosition', {
                position: currentIndex + 1,
                total: media.length,
              })}
              tone="onPrimary"
            >
              {t('posts.photos.viewerPosition', {
                position: currentIndex + 1,
                total: media.length,
              })}
            </AppText>
            <ViewerNavigationButton
              disabled={currentIndex >= media.length - 1}
              icon="chevron-forward"
              label={t('posts.photos.next')}
              onPress={() => goToIndex(currentIndex + 1)}
            />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function ZoomablePostPhoto({
  hasLoadError,
  index,
  isLoading,
  item,
  onImageError,
  total,
  uri,
  width,
}: {
  hasLoadError: boolean;
  index: number;
  isLoading: boolean;
  item: PostMedia;
  onImageError: (() => void) | undefined;
  total: number;
  uri: string | undefined;
  width: number;
}) {
  const { t } = useTranslation();
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const canShowImage = Boolean(uri && failedUri !== uri);
  const imageLoading = canShowImage && loadedUri !== uri;

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(1, startScale.value * event.scale));
    })
    .onEnd(() => {
      startScale.value = scale.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_event, success) => {
      if (!success) return;
      const nextScale = scale.value > 1.05 ? 1 : 2.5;
      scale.value = withTiming(nextScale);
      startScale.value = nextScale;
    });
  const zoomGesture = Gesture.Simultaneous(pinch, doubleTap);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={[styles.page, { width }]}>
      {canShowImage ? (
        <GestureDetector gesture={zoomGesture}>
          <Animated.View style={[styles.zoomSurface, animatedStyle]}>
            <Image
              accessibilityLabel={t('posts.photos.fullscreen', {
                position: index + 1,
                total,
              })}
              accessibilityRole="image"
              cachePolicy="memory-disk"
              contentFit="contain"
              onError={() => {
                setFailedUri(uri ?? null);
                onImageError?.();
              }}
              onLoad={() => setLoadedUri(uri ?? null)}
              recyclingKey={`${item.id}-${uri}`}
              source={{ uri: uri! }}
              style={styles.image}
            />
          </Animated.View>
        </GestureDetector>
      ) : isLoading && !hasLoadError ? (
        <ActivityIndicator color={lightColors.onPrimary} size="large" />
      ) : (
        <View accessibilityRole="alert" style={styles.errorState}>
          <Ionicons
            color={lightColors.onPrimary}
            name="image-outline"
            size={40}
          />
          <AppText style={styles.errorText} tone="onPrimary">
            {t('posts.photos.viewerLoadError')}
          </AppText>
        </View>
      )}
      {imageLoading && canShowImage ? (
        <ActivityIndicator
          color={lightColors.onPrimary}
          size="large"
          style={styles.imageLoader}
        />
      ) : null}
    </View>
  );
}

function ViewerNavigationButton({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean;
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navigationButton,
        disabled && styles.disabledButton,
        pressed && styles.pressedButton,
      ]}
    >
      <Ionicons color={lightColors.onPrimary} name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: '#000000' },
  closeButton: {
    position: 'absolute',
    right: spacing.xl,
    top: spacing.md,
    zIndex: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  pages: { flex: 1 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zoomSurface: { width: '100%', height: '78%' },
  image: { width: '100%', height: '100%' },
  imageLoader: { position: 'absolute' },
  errorState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  errorText: { textAlign: 'center' },
  controls: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.md,
    left: spacing.xl,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navigationButton: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  disabledButton: { opacity: 0.28 },
  pressedButton: { opacity: 0.62 },
});
