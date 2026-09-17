import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { IconButton } from '@/components/icon-button';
import { modalSupportedOrientations } from '@/config/orientation';
import { createStorageImageSource } from '@/features/media/storage-signed-url';
import { lightColors, layout, radius, spacing } from '@/theme';
import type { PostMedia } from '@/types/database';

import { postMediaBucket } from '../post-media';

import {
  clampPhotoViewerIndex,
  clampZoomedPhotoOffset,
  getPhotoViewerIndexFromOffset,
  getPhotoViewerPageLayout,
  getPhotoViewerPageOffset,
  shouldCaptureZoomedPhotoPan,
} from '../photo-viewer-state';
import {
  canSavePostPhotoToLibrary,
  postPhotoSaveDependencies,
} from '../post-photo-save-adapter';
import { createPostPhotoSaver, getCurrentPostPhoto } from '../post-photo-save';

type PostPhotoViewerProps = {
  hasLoadError?: boolean;
  initialIndex: number;
  isLoading?: boolean;
  media: PostMedia[];
  mediaUrls: Record<string, string>;
  onClose: () => void;
  onImageError?: (storagePath: string) => void;
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
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<PostMedia>>(null);
  const [currentIndex, setCurrentIndex] = useState(() =>
    clampPhotoViewerIndex(initialIndex, media.length),
  );
  const currentIndexRef = useRef(currentIndex);
  const pageWidthRef = useRef(0);
  const [pagerViewport, setPagerViewport] = useState({ height: 0, width: 0 });
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isCurrentPhotoZoomed, setIsCurrentPhotoZoomed] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    message: string;
    tone: 'error' | 'success';
  } | null>(null);
  const saveInFlight = useRef(false);
  const saveFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savePhoto] = useState(() =>
    createPostPhotoSaver(postPhotoSaveDependencies),
  );

  useEffect(() => {
    if (!visible || media.length === 0) return;
    const nextIndex = clampPhotoViewerIndex(initialIndex, media.length);
    currentIndexRef.current = nextIndex;
    const pageWidth = pageWidthRef.current;
    const frame = requestAnimationFrame(() => {
      setCurrentIndex(nextIndex);
      setIsCurrentPhotoZoomed(false);
      if (pageWidth > 0) {
        listRef.current?.scrollToOffset({
          animated: false,
          offset: getPhotoViewerPageOffset(nextIndex, pageWidth, media.length),
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialIndex, media.length, visible]);

  useEffect(
    () => () => {
      if (saveFeedbackTimer.current) {
        clearTimeout(saveFeedbackTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!visible || pagerViewport.width <= 0 || media.length === 0) return;
    const nextIndex = clampPhotoViewerIndex(
      currentIndexRef.current,
      media.length,
    );
    currentIndexRef.current = nextIndex;
    const frame = requestAnimationFrame(() => {
      setCurrentIndex(nextIndex);
      setIsCurrentPhotoZoomed(false);
      listRef.current?.scrollToOffset({
        animated: false,
        offset: getPhotoViewerPageOffset(
          nextIndex,
          pagerViewport.width,
          media.length,
        ),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [media.length, pagerViewport.width, visible]);

  if (!visible) return null;

  const goToIndex = (index: number) => {
    const nextIndex = clampPhotoViewerIndex(index, media.length);
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setIsCurrentPhotoZoomed(false);
    setSaveFeedback(null);
    listRef.current?.scrollToOffset({
      animated: true,
      offset: getPhotoViewerPageOffset(
        nextIndex,
        pagerViewport.width,
        media.length,
      ),
    });
  };
  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = getPhotoViewerIndexFromOffset(
      event.nativeEvent.contentOffset.x,
      pagerViewport.width,
      media.length,
    );
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setIsCurrentPhotoZoomed(false);
    setSaveFeedback(null);
  };
  const handlePagerLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    pageWidthRef.current = width;
    setPagerViewport((current) =>
      current.width === width && current.height === height
        ? current
        : { height, width },
    );
  };
  const currentPhoto = getCurrentPostPhoto(media, mediaUrls, currentIndex);
  const showSaveFeedback = (message: string, tone: 'error' | 'success') => {
    if (saveFeedbackTimer.current) clearTimeout(saveFeedbackTimer.current);
    setSaveFeedback({ message, tone });
    saveFeedbackTimer.current = setTimeout(
      () => {
        setSaveFeedback(null);
        saveFeedbackTimer.current = null;
      },
      tone === 'error' ? 4500 : 2800,
    );
  };
  const handleSavePhoto = async () => {
    if (!currentPhoto || saveInFlight.current) return;

    saveInFlight.current = true;
    setSaveFeedback(null);
    setIsSavingPhoto(true);
    const result = await savePhoto(currentPhoto).finally(() => {
      saveInFlight.current = false;
      setIsSavingPhoto(false);
    });

    if (result === 'saved') {
      showSaveFeedback(t('posts.photos.saveSuccess'), 'success');
    } else if (result === 'permission-denied') {
      showSaveFeedback(t('posts.photos.savePermissionDenied'), 'error');
    } else if (result === 'permission-blocked') {
      Alert.alert(
        t('posts.photos.savePermissionTitle'),
        t('posts.photos.savePermissionBlocked'),
        [
          { style: 'cancel', text: t('common.cancel') },
          {
            onPress: () => void Linking.openSettings(),
            text: t('posts.photos.openSettings'),
          },
        ],
      );
    } else if (result === 'failed') {
      showSaveFeedback(t('posts.photos.saveError'), 'error');
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={modalSupportedOrientations}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaProvider>
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
            style={[styles.closeButton, { top: insets.top + spacing.md }]}
          />
          {canSavePostPhotoToLibrary && currentPhoto ? (
            <Pressable
              accessibilityLabel={
                isSavingPhoto
                  ? t('posts.photos.saveLoadingAccessibility')
                  : t('posts.photos.saveAccessibility')
              }
              accessibilityRole="button"
              accessibilityState={{
                busy: isSavingPhoto,
                disabled: isSavingPhoto,
              }}
              disabled={isSavingPhoto}
              onPress={() => void handleSavePhoto()}
              style={({ pressed }) => [
                styles.saveButton,
                { top: insets.top + spacing.md },
                pressed && styles.pressedButton,
              ]}
            >
              {isSavingPhoto ? (
                <ActivityIndicator color={lightColors.onPrimary} size="small" />
              ) : (
                <Ionicons
                  color={lightColors.onPrimary}
                  name="download-outline"
                  size={20}
                />
              )}
              <AppText tone="onPrimary" variant="subheadline">
                {t('posts.photos.save')}
              </AppText>
            </Pressable>
          ) : null}

          <View onLayout={handlePagerLayout} style={styles.pages}>
            {pagerViewport.width > 0 && pagerViewport.height > 0 ? (
              <FlatList
                data={media}
                decelerationRate="fast"
                extraData={{ currentIndex, mediaUrls }}
                getItemLayout={(_, index) =>
                  getPhotoViewerPageLayout(index, pagerViewport.width)
                }
                horizontal
                initialScrollIndex={clampPhotoViewerIndex(
                  initialIndex,
                  media.length,
                )}
                keyExtractor={(item) => item.id}
                onMomentumScrollEnd={handleScrollEnd}
                pagingEnabled
                ref={listRef}
                removeClippedSubviews={false}
                renderItem={({ item, index }) => (
                  <ZoomablePostPhoto
                    hasLoadError={hasLoadError}
                    index={index}
                    isLoading={isLoading}
                    item={item}
                    onImageError={onImageError}
                    onZoomChange={
                      index === currentIndex
                        ? setIsCurrentPhotoZoomed
                        : undefined
                    }
                    total={media.length}
                    uri={mediaUrls[item.storage_path]}
                    viewportHeight={pagerViewport.height}
                    width={pagerViewport.width}
                  />
                )}
                showsHorizontalScrollIndicator={false}
                scrollEnabled={!isCurrentPhotoZoomed}
                style={styles.pages}
              />
            ) : null}
          </View>

          {media.length > 1 ? (
            <View
              style={[styles.controls, { bottom: insets.bottom + spacing.md }]}
            >
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
          {saveFeedback ? (
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={[
                styles.saveFeedback,
                saveFeedback.tone === 'error'
                  ? styles.saveFeedbackError
                  : styles.saveFeedbackSuccess,
              ]}
            >
              <AppText
                tone={saveFeedback.tone === 'error' ? 'onPrimary' : 'primary'}
                variant="subheadline"
              >
                {saveFeedback.message}
              </AppText>
            </View>
          ) : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function ZoomablePostPhoto({
  hasLoadError,
  index,
  isLoading,
  item,
  onImageError,
  onZoomChange,
  total,
  uri,
  viewportHeight,
  width,
}: {
  hasLoadError: boolean;
  index: number;
  isLoading: boolean;
  item: PostMedia;
  onImageError: ((storagePath: string) => void) | undefined;
  onZoomChange: ((isZoomed: boolean) => void) | undefined;
  total: number;
  uri: string | undefined;
  viewportHeight: number;
  width: number;
}) {
  const { t } = useTranslation();
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startTranslateX = useSharedValue(0);
  const startTranslateY = useSharedValue(0);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const canShowImage = Boolean(uri && failedUri !== uri);
  const imageLoading = canShowImage && loadedUri !== uri;
  const reportZoomChange = (nextIsZoomed: boolean) => {
    setIsZoomed(nextIsZoomed);
    onZoomChange?.(nextIsZoomed);
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(1, startScale.value * event.scale));
    })
    .onEnd(() => {
      startScale.value = scale.value;
      translateX.value = clampZoomedPhotoOffset(
        translateX.value,
        width,
        scale.value,
      );
      scheduleOnRN(reportZoomChange, shouldCaptureZoomedPhotoPan(scale.value));
      translateY.value = clampZoomedPhotoOffset(
        translateY.value,
        viewportHeight * 0.78,
        scale.value,
      );
    });
  const zoomedPan = Gesture.Pan()
    .onStart(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = clampZoomedPhotoOffset(
        startTranslateX.value + event.translationX,
        width,
        scale.value,
      );
      translateY.value = clampZoomedPhotoOffset(
        startTranslateY.value + event.translationY,
        viewportHeight * 0.78,
        scale.value,
      );
    })
    .onEnd(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_event, success) => {
      if (!success) return;
      const nextScale = scale.value > 1.05 ? 1 : 2.5;
      scale.value = withTiming(nextScale);
      startScale.value = nextScale;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      startTranslateX.value = 0;
      startTranslateY.value = 0;
      scheduleOnRN(reportZoomChange, shouldCaptureZoomedPhotoPan(nextScale));
    });
  const zoomGesture = isZoomed
    ? Gesture.Simultaneous(pinch, zoomedPan, doubleTap)
    : Gesture.Simultaneous(pinch, doubleTap);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <View style={[styles.page, { height: viewportHeight, width }]}>
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
                onImageError?.(item.storage_path);
              }}
              onLoad={() => setLoadedUri(uri ?? null)}
              recyclingKey={`${item.id}-${uri}`}
              source={createStorageImageSource(
                postMediaBucket,
                item.storage_path,
                uri,
              )}
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
    zIndex: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  saveButton: {
    position: 'absolute',
    left: spacing.xl,
    zIndex: 3,
    minHeight: layout.minimumTouchTarget,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pages: { flex: 1 },
  page: { alignItems: 'center', justifyContent: 'center' },
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
  saveFeedback: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.md + layout.minimumTouchTarget + spacing.md,
    left: spacing.xl,
    zIndex: 4,
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  saveFeedbackSuccess: { backgroundColor: lightColors.secondarySoft },
  saveFeedbackError: { backgroundColor: lightColors.error },
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
