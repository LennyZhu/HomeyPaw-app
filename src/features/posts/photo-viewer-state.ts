export function clampPhotoViewerIndex(index: number, photoCount: number) {
  if (photoCount <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), photoCount - 1);
}

export const photoZoomPagingThreshold = 1.05;

export function getPhotoViewerIndexFromOffset(
  offset: number,
  pageWidth: number,
  photoCount: number,
) {
  if (!Number.isFinite(offset) || pageWidth <= 0) return 0;
  return clampPhotoViewerIndex(Math.round(offset / pageWidth), photoCount);
}

export function shouldCaptureZoomedPhotoPan(scale: number) {
  'worklet';
  return scale > photoZoomPagingThreshold;
}

export function clampZoomedPhotoOffset(
  offset: number,
  viewportSize: number,
  scale: number,
) {
  'worklet';
  const limit = Math.max(0, (viewportSize * (scale - 1)) / 2);
  return Math.min(limit, Math.max(-limit, offset));
}
