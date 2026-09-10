import type { PostMediaDraft } from './post-media';

export type PhotoCropAspect = 'free' | 'fourThree' | 'sixteenNine' | 'square';

export type PhotoSticker = {
  emoji: string;
  id: string;
  rotation: number;
  scale: number;
  x: number;
  y: number;
};

export type EditedPhotoResult = {
  height: number;
  uri: string;
  width: number;
};

export const photoStickerChoices = [
  '🐶',
  '🐱',
  '🐾',
  '❤️',
  '⭐',
  '🎂',
  '🥰',
  '😂',
  '✨',
  '💊',
  '🍖',
] as const;

export function clampPhotoEditorValue(
  value: number,
  minimum: number,
  maximum: number,
) {
  'worklet';
  return Math.min(maximum, Math.max(minimum, value));
}

export function getNextPhotoRotation(rotation: number) {
  return (((Math.trunc(rotation / 90) + 1) % 4) * 90) as 0 | 90 | 180 | 270;
}

export function createEditedPostMediaDraft(
  source: PostMediaDraft,
  result: EditedPhotoResult,
  replacementId: string,
) {
  return {
    editTempUri: result.uri,
    height: result.height,
    id: source.kind === 'new' ? source.id : replacementId,
    kind: 'new',
    uri: result.uri,
    width: result.width,
  } as const;
}

export function getPhotoCropHeight({
  aspect,
  freeHeight,
  maximumHeight,
  minimumHeight,
  width,
}: {
  aspect: PhotoCropAspect;
  freeHeight: number;
  maximumHeight: number;
  minimumHeight: number;
  width: number;
}) {
  const requestedHeight =
    aspect === 'square'
      ? width
      : aspect === 'fourThree'
        ? width * 0.75
        : aspect === 'sixteenNine'
          ? width * 0.5625
          : freeHeight;

  return clampPhotoEditorValue(requestedHeight, minimumHeight, maximumHeight);
}

export function clampPhotoSticker(
  sticker: PhotoSticker,
  canvasWidth: number,
  canvasHeight: number,
) {
  const padding = 28 * clampPhotoEditorValue(sticker.scale, 0.5, 3);
  return {
    ...sticker,
    rotation: Number.isFinite(sticker.rotation) ? sticker.rotation : 0,
    scale: clampPhotoEditorValue(sticker.scale, 0.5, 3),
    x: clampPhotoEditorValue(sticker.x, padding, canvasWidth - padding),
    y: clampPhotoEditorValue(sticker.y, padding, canvasHeight - padding),
  };
}

export function removePhotoSticker(stickers: PhotoSticker[], id: string) {
  return stickers.filter((sticker) => sticker.id !== id);
}

export function getPhotoEditorExportSize(
  canvasWidth: number,
  canvasHeight: number,
  maximumEdge = 2048,
) {
  const scale = maximumEdge / Math.max(canvasWidth, canvasHeight, 1);
  return {
    height: Math.max(1, Math.round(canvasHeight * scale)),
    width: Math.max(1, Math.round(canvasWidth * scale)),
  };
}
