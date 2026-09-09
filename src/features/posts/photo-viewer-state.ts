export function clampPhotoViewerIndex(index: number, photoCount: number) {
  if (photoCount <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), photoCount - 1);
}
