import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useTranslation } from 'react-i18next';

import { contentStyles } from '@/components/content-container';
import { AppText } from '@/components/app-text';
import { modalSupportedOrientations } from '@/config/orientation';
import { lightColors, layout, radius, spacing } from '@/theme';

import {
  clampPhotoEditorValue,
  clampPhotoSticker,
  getNextPhotoRotation,
  getPhotoCropHeight,
  getPhotoEditorDisplayScale,
  photoStickerChoices,
  removePhotoSticker,
  type PhotoCropAspect,
  type EditedPhotoResult,
  type PhotoSticker,
} from '../photo-editor-state';
import type { PostMediaDraft } from '../post-media';
import { exportPostPhotoCanvas } from '../post-photo-editor-export';

type Props = {
  draft: PostMediaDraft;
  onCancel: () => void;
  onDone: (result: EditedPhotoResult) => void;
};

type EditorTool = 'crop' | 'sticker' | null;

const waitForCanvasPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

export function PostPhotoEditor({ draft, onCancel, onDone }: Props) {
  const { t } = useTranslation();
  const { height: viewportHeight, width: viewportWidth } =
    useWindowDimensions();
  const canvasRef = useRef<View>(null);
  // Keep editing coordinates stable across rotation and multitasking resize.
  // Only the presentation shell scales; the exported canvas stays unchanged.
  const [canvasWidth] = useState(() =>
    Math.max(
      1,
      Math.min(layout.contentMaxWidth, viewportWidth - spacing.xl * 2),
    ),
  );
  const [stageSize, setStageSize] = useState({
    width: viewportWidth,
    height: viewportHeight * 0.57,
  });
  const minimumCanvasHeight = Math.max(176, canvasWidth * 0.52);
  const maximumCanvasHeight = canvasWidth * 1.5;
  const sourceHeight = Math.max(1, draft.height);
  const sourceWidth = Math.max(1, draft.width);
  const initialFreeHeight = clampPhotoEditorValue(
    canvasWidth * (sourceHeight / sourceWidth),
    minimumCanvasHeight,
    Math.min(viewportHeight * 0.57, maximumCanvasHeight),
  );
  const [aspect, setAspect] = useState<PhotoCropAspect>('free');
  const [freeHeight, setFreeHeight] = useState(initialFreeHeight);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [tool, setTool] = useState<EditorTool>('crop');
  const [stickers, setStickers] = useState<PhotoSticker[]>([]);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(
    null,
  );
  const [isImageReady, setIsImageReady] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasHeight = getPhotoCropHeight({
    aspect,
    freeHeight,
    maximumHeight: maximumCanvasHeight,
    minimumHeight: minimumCanvasHeight,
    width: canvasWidth,
  });
  const displayScale = getPhotoEditorDisplayScale(
    canvasWidth,
    canvasHeight,
    stageSize.width - spacing.xl * 2,
    stageSize.height - layout.minimumTouchTarget - spacing.md,
  );
  const setFreeCropHeight = (nextHeight: number) => {
    const height = clampPhotoEditorValue(
      nextHeight,
      minimumCanvasHeight,
      maximumCanvasHeight,
    );
    setFreeHeight(height);
    setStickers((current) =>
      current.map((sticker) => clampPhotoSticker(sticker, canvasWidth, height)),
    );
  };
  const resizeStartHeight = useSharedValue(freeHeight);
  const resizeGesture = Gesture.Pan()
    .onBegin(() => {
      resizeStartHeight.value = freeHeight;
    })
    .onUpdate((event) => {
      scheduleOnRN(
        setFreeCropHeight,
        clampPhotoEditorValue(
          resizeStartHeight.value + event.translationY / displayScale,
          minimumCanvasHeight,
          maximumCanvasHeight,
        ),
      );
    });

  const chooseAspect = (nextAspect: PhotoCropAspect) => {
    setAspect(nextAspect);
    const nextHeight = getPhotoCropHeight({
      aspect: nextAspect,
      freeHeight,
      maximumHeight: maximumCanvasHeight,
      minimumHeight: minimumCanvasHeight,
      width: canvasWidth,
    });
    setStickers((current) =>
      current.map((sticker) =>
        clampPhotoSticker(sticker, canvasWidth, nextHeight),
      ),
    );
  };
  const addSticker = (emoji: string) => {
    const sticker = clampPhotoSticker(
      {
        emoji,
        id: Crypto.randomUUID(),
        rotation: 0,
        scale: 1,
        x: canvasWidth / 2,
        y: canvasHeight / 2,
      },
      canvasWidth,
      canvasHeight,
    );
    setStickers((current) => [...current, sticker]);
    setSelectedStickerId(sticker.id);
  };
  const updateSticker = (id: string, next: PhotoSticker) => {
    setStickers((current) =>
      current.map((sticker) =>
        sticker.id === id
          ? clampPhotoSticker(next, canvasWidth, canvasHeight)
          : sticker,
      ),
    );
  };
  const removeSelectedSticker = () => {
    if (!selectedStickerId) return;
    setStickers((current) => removePhotoSticker(current, selectedStickerId));
    setSelectedStickerId(null);
  };
  const finishEditing = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !isImageReady || isExporting) return;

    setError(null);
    setIsExporting(true);
    try {
      await waitForCanvasPaint();
      const result = await exportPostPhotoCanvas(
        canvas,
        sourceWidth,
        sourceHeight,
        canvasWidth,
        canvasHeight,
      );
      onDone(result);
    } catch {
      setError(t('posts.photoEditor.errors.export'));
      setIsExporting(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={isExporting ? undefined : onCancel}
      supportedOrientations={modalSupportedOrientations}
      presentationStyle="fullScreen"
      visible
    >
      <SafeAreaProvider>
        <SafeAreaView
          edges={['top', 'bottom', 'left', 'right']}
          style={styles.safeArea}
        >
          <StatusBar style="light" />
          <View style={[contentStyles.readable, styles.topBar]}>
            <EditorTextButton
              disabled={isExporting}
              label={t('common.cancel')}
              onPress={onCancel}
            />
            <AppText
              style={styles.editorTitle}
              tone="onPrimary"
              variant="headline"
            >
              {t('posts.photoEditor.title')}
            </AppText>
            <EditorTextButton
              disabled={!isImageReady || isExporting}
              label={t('common.done')}
              loading={isExporting}
              onPress={() => void finishEditing()}
            />
          </View>

          <View
            style={styles.stage}
            onLayout={({ nativeEvent }) => setStageSize(nativeEvent.layout)}
          >
            <View
              style={{
                width: canvasWidth * displayScale,
                height: canvasHeight * displayScale + layout.minimumTouchTarget,
              }}
            >
              <View
                style={[
                  styles.canvasShell,
                  {
                    width: canvasWidth,
                    height: canvasHeight,
                    transform: [{ scale: displayScale }],
                    transformOrigin: 'top left',
                  },
                ]}
              >
                <View
                  collapsable={false}
                  ref={canvasRef}
                  style={[
                    styles.canvas,
                    { height: canvasHeight, width: canvasWidth },
                  ]}
                >
                  <EditablePhotoLayer
                    canvasHeight={canvasHeight}
                    canvasWidth={canvasWidth}
                    displayScale={displayScale}
                    key={`${rotation}-${canvasWidth}-${canvasHeight}`}
                    onError={() => {
                      setIsImageReady(false);
                      setError(t('posts.photoEditor.errors.unsupported'));
                    }}
                    onReady={() => setIsImageReady(true)}
                    rotation={rotation}
                    sourceHeight={sourceHeight}
                    sourceWidth={sourceWidth}
                    uri={draft.uri}
                  />
                  {stickers.map((sticker) => (
                    <EditableSticker
                      canvasHeight={canvasHeight}
                      canvasWidth={canvasWidth}
                      exporting={isExporting}
                      displayScale={displayScale}
                      key={sticker.id}
                      onChange={updateSticker}
                      onSelect={setSelectedStickerId}
                      selected={selectedStickerId === sticker.id}
                      sticker={sticker}
                    />
                  ))}
                </View>
              </View>
              {tool === 'crop' && aspect === 'free' ? (
                <GestureDetector gesture={resizeGesture}>
                  <View
                    accessibilityLabel={t('posts.photoEditor.resizeCrop')}
                    accessibilityRole="adjustable"
                    style={[
                      styles.cropHandleTouch,
                      { top: canvasHeight * displayScale },
                    ]}
                  >
                    <View style={styles.cropHandle} />
                  </View>
                </GestureDetector>
              ) : null}
            </View>
            {!isImageReady && !error ? (
              <ActivityIndicator color={lightColors.onPrimary} size="large" />
            ) : null}
            {error ? (
              <AppText
                accessibilityRole="alert"
                style={styles.error}
                tone="onPrimary"
                variant="footnote"
              >
                {error}
              </AppText>
            ) : null}
          </View>

          <ScrollView
            style={[contentStyles.readable, styles.bottomPanel]}
            contentContainerStyle={styles.bottomContent}
            bounces={false}
          >
            {tool === 'crop' ? (
              <View style={styles.toolOptions}>
                <View style={styles.aspectRow}>
                  {(
                    [
                      ['free', t('posts.photoEditor.aspects.free')],
                      ['square', '1:1'],
                      ['fourThree', '4:3'],
                      ['sixteenNine', '16:9'],
                    ] as const
                  ).map(([value, label]) => (
                    <OptionPill
                      key={value}
                      label={label}
                      onPress={() => chooseAspect(value)}
                      selected={aspect === value}
                    />
                  ))}
                </View>
                {aspect === 'free' ? (
                  <View style={styles.freeCropActions}>
                    <EditorIconButton
                      icon="remove"
                      label={t('posts.photoEditor.reduceCrop')}
                      onPress={() => setFreeCropHeight(freeHeight - 24)}
                    />
                    <AppText tone="secondary" variant="footnote">
                      {t('posts.photoEditor.dragCrop')}
                    </AppText>
                    <EditorIconButton
                      icon="add"
                      label={t('posts.photoEditor.increaseCrop')}
                      onPress={() => setFreeCropHeight(freeHeight + 24)}
                    />
                  </View>
                ) : null}
              </View>
            ) : tool === 'sticker' ? (
              <View style={styles.toolOptions}>
                <ScrollView
                  contentContainerStyle={styles.stickerChoices}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  {photoStickerChoices.map((emoji) => (
                    <Pressable
                      accessibilityLabel={t('posts.photoEditor.addSticker', {
                        sticker: emoji,
                      })}
                      accessibilityRole="button"
                      key={emoji}
                      onPress={() => addSticker(emoji)}
                      style={({ pressed }) => [
                        styles.stickerChoice,
                        pressed && styles.pressed,
                      ]}
                    >
                      <AppText style={styles.stickerChoiceText}>
                        {emoji}
                      </AppText>
                    </Pressable>
                  ))}
                </ScrollView>
                {selectedStickerId ? (
                  <Pressable
                    accessibilityLabel={t('posts.photoEditor.deleteSticker')}
                    accessibilityRole="button"
                    onPress={removeSelectedSticker}
                    style={({ pressed }) => [
                      styles.deleteSticker,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      color={lightColors.error}
                      name="trash-outline"
                      size={20}
                    />
                    <AppText tone="error" variant="subheadline">
                      {t('posts.photoEditor.deleteSticker')}
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.toolPlaceholder} />
            )}

            <View style={styles.toolBar}>
              <EditorToolButton
                icon="crop-outline"
                label={t('posts.photoEditor.crop')}
                onPress={() => setTool(tool === 'crop' ? null : 'crop')}
                selected={tool === 'crop'}
              />
              <EditorToolButton
                icon="refresh-outline"
                label={t('posts.photoEditor.rotate')}
                onPress={() => setRotation(getNextPhotoRotation(rotation))}
                selected={false}
              />
              <EditorToolButton
                icon="happy-outline"
                label={t('posts.photoEditor.sticker')}
                onPress={() => setTool(tool === 'sticker' ? null : 'sticker')}
                selected={tool === 'sticker'}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function EditablePhotoLayer({
  canvasHeight,
  canvasWidth,
  displayScale,
  onError,
  onReady,
  rotation,
  sourceHeight,
  sourceWidth,
  uri,
}: {
  canvasHeight: number;
  canvasWidth: number;
  displayScale: number;
  onError: () => void;
  onReady: () => void;
  rotation: 0 | 90 | 180 | 270;
  sourceHeight: number;
  sourceWidth: number;
  uri: string;
}) {
  const rotated = rotation === 90 || rotation === 270;
  const orientedWidth = rotated ? sourceHeight : sourceWidth;
  const orientedHeight = rotated ? sourceWidth : sourceHeight;
  const baseScale = Math.max(
    canvasWidth / orientedWidth,
    canvasHeight / orientedHeight,
  );
  const renderedWidth = sourceWidth * baseScale;
  const renderedHeight = sourceHeight * baseScale;
  const zoom = useSharedValue(1);
  const startZoom = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startOffsetX = useSharedValue(0);
  const startOffsetY = useSharedValue(0);
  const limitX = (nextZoom: number) => {
    'worklet';
    return Math.max(
      0,
      (orientedWidth * baseScale * nextZoom - canvasWidth) / 2,
    );
  };
  const limitY = (nextZoom: number) => {
    'worklet';
    return Math.max(
      0,
      (orientedHeight * baseScale * nextZoom - canvasHeight) / 2,
    );
  };
  const pan = Gesture.Pan()
    .onStart(() => {
      startOffsetX.value = offsetX.value;
      startOffsetY.value = offsetY.value;
    })
    .onUpdate((event) => {
      offsetX.value = clampPhotoEditorValue(
        startOffsetX.value + event.translationX / displayScale,
        -limitX(zoom.value),
        limitX(zoom.value),
      );
      offsetY.value = clampPhotoEditorValue(
        startOffsetY.value + event.translationY / displayScale,
        -limitY(zoom.value),
        limitY(zoom.value),
      );
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      startZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      zoom.value = clampPhotoEditorValue(startZoom.value * event.scale, 1, 4);
      offsetX.value = clampPhotoEditorValue(
        offsetX.value,
        -limitX(zoom.value),
        limitX(zoom.value),
      );
      offsetY.value = clampPhotoEditorValue(
        offsetY.value,
        -limitY(zoom.value),
        limitY(zoom.value),
      );
    });
  const gesture = Gesture.Simultaneous(pan, pinch);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: zoom.value },
      { rotate: `${rotation}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.editableImage,
          {
            height: renderedHeight,
            left: (canvasWidth - renderedWidth) / 2,
            top: (canvasHeight - renderedHeight) / 2,
            width: renderedWidth,
          },
          animatedStyle,
        ]}
      >
        <Image
          contentFit="fill"
          onError={onError}
          onLoad={onReady}
          source={uri}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </GestureDetector>
  );
}

function EditableSticker({
  canvasHeight,
  canvasWidth,
  exporting,
  displayScale,
  onChange,
  onSelect,
  selected,
  sticker,
}: {
  canvasHeight: number;
  canvasWidth: number;
  exporting: boolean;
  displayScale: number;
  onChange: (id: string, next: PhotoSticker) => void;
  onSelect: (id: string) => void;
  selected: boolean;
  sticker: PhotoSticker;
}) {
  const x = useSharedValue(sticker.x);
  const y = useSharedValue(sticker.y);
  const scale = useSharedValue(sticker.scale);
  const rotation = useSharedValue(sticker.rotation);
  const startX = useSharedValue(sticker.x);
  const startY = useSharedValue(sticker.y);
  const startScale = useSharedValue(sticker.scale);
  const startRotation = useSharedValue(sticker.rotation);
  const select = () => onSelect(sticker.id);
  const persist = () =>
    onChange(sticker.id, {
      ...sticker,
      rotation: rotation.value,
      scale: scale.value,
      x: x.value,
      y: y.value,
    });
  const pan = Gesture.Pan()
    .onBegin(() => scheduleOnRN(select))
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((event) => {
      const padding = 28 * scale.value;
      x.value = clampPhotoEditorValue(
        startX.value + event.translationX / displayScale,
        padding,
        canvasWidth - padding,
      );
      y.value = clampPhotoEditorValue(
        startY.value + event.translationY / displayScale,
        padding,
        canvasHeight - padding,
      );
    })
    .onFinalize(() => scheduleOnRN(persist));
  const pinch = Gesture.Pinch()
    .onBegin(() => scheduleOnRN(select))
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = clampPhotoEditorValue(
        startScale.value * event.scale,
        0.5,
        3,
      );
    })
    .onFinalize(() => scheduleOnRN(persist));
  const rotate = Gesture.Rotation()
    .onBegin(() => scheduleOnRN(select))
    .onStart(() => {
      startRotation.value = rotation.value;
    })
    .onUpdate((event) => {
      rotation.value = startRotation.value + (event.rotation * 180) / Math.PI;
    })
    .onFinalize(() => scheduleOnRN(persist));
  const tap = Gesture.Tap().onEnd((_event, success) => {
    if (success) scheduleOnRN(select);
  });
  const gesture = Gesture.Simultaneous(pan, pinch, rotate, tap);
  useEffect(() => {
    x.value = sticker.x;
    y.value = sticker.y;
    scale.value = sticker.scale;
    rotation.value = sticker.rotation;
  }, [sticker, x, y, scale, rotation]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - 28 },
      { translateY: y.value - 28 },
      { scale: scale.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityLabel={sticker.emoji}
        accessibilityRole="image"
        style={[
          styles.editableSticker,
          selected && !exporting && styles.selectedSticker,
          animatedStyle,
        ]}
      >
        <AppText style={styles.editableStickerText}>{sticker.emoji}</AppText>
      </Animated.View>
    </GestureDetector>
  );
}

function EditorTextButton({
  disabled,
  label,
  loading = false,
  onPress,
}: {
  disabled: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.topAction,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={lightColors.onPrimary} size="small" />
      ) : (
        <AppText tone="onPrimary" variant="subheadline">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

function EditorToolButton({
  icon,
  label,
  onPress,
  selected,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolButton,
        selected && styles.toolButtonSelected,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        color={selected ? lightColors.primary : lightColors.textPrimary}
        name={icon}
        size={23}
      />
      <AppText tone={selected ? 'brand' : 'primary'} variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

function EditorIconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.editorIconButton,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons color={lightColors.textPrimary} name={icon} size={20} />
    </Pressable>
  );
}

function OptionPill({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionPill,
        selected && styles.optionPillSelected,
        pressed && styles.pressed,
      ]}
    >
      <AppText tone={selected ? 'onPrimary' : 'secondary'} variant="footnote">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  editorTitle: { flexShrink: 1, textAlign: 'center' },
  safeArea: { flex: 1, backgroundColor: '#141210' },
  topBar: {
    minHeight: 56,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  topAction: {
    minWidth: 72,
    minHeight: layout.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  canvasShell: { alignItems: 'center', justifyContent: 'center' },
  canvas: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  editableImage: { position: 'absolute' },
  cropHandleTouch: {
    width: 88,
    height: layout.minimumTouchTarget,
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropHandle: {
    width: 48,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: radius.full,
  },
  editableSticker: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 56,
    height: 56,
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0)',
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: 'center',
  },
  selectedSticker: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: lightColors.onPrimary,
  },
  editableStickerText: { fontSize: 42, lineHeight: 52 },
  error: {
    maxWidth: 320,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  bottomPanel: {
    flexGrow: 0,
    maxHeight: '45%',
    backgroundColor: lightColors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  bottomContent: { paddingBottom: spacing.sm },
  toolOptions: { minHeight: 104, gap: spacing.sm },
  aspectRow: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  optionPill: {
    minWidth: 56,
    minHeight: layout.minimumTouchTarget,
    alignItems: 'center',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.full,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  optionPillSelected: { backgroundColor: lightColors.primary },
  freeCropActions: {
    flexWrap: 'wrap',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  editorIconButton: {
    width: layout.minimumTouchTarget,
    height: layout.minimumTouchTarget,
    alignItems: 'center',
    backgroundColor: lightColors.surfaceSecondary,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
  stickerChoices: { gap: spacing.sm, paddingHorizontal: spacing.xs },
  stickerChoice: {
    width: 52,
    height: 52,
    alignItems: 'center',
    backgroundColor: lightColors.surface,
    borderRadius: radius.md,
    justifyContent: 'center',
  },
  stickerChoiceText: { fontSize: 30, lineHeight: 38 },
  deleteSticker: {
    minHeight: 44,
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  toolPlaceholder: { minHeight: 104 },
  toolBar: {
    alignItems: 'center',
    borderTopColor: lightColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacing.sm,
  },
  toolButton: {
    minWidth: 76,
    minHeight: 58,
    alignItems: 'center',
    borderRadius: radius.md,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  toolButtonSelected: { backgroundColor: lightColors.primarySoft },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.62 },
});
