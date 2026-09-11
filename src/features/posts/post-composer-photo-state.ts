export type PostPhotoAddPresentation = 'button' | 'none' | 'tile';

export function getPostPhotoAddPresentation(
  photoCount: number,
  maximum: number,
): PostPhotoAddPresentation {
  if (photoCount <= 0) return 'button';
  return photoCount < maximum ? 'tile' : 'none';
}

export function movePostPhoto<T>(
  photos: T[],
  index: number,
  direction: -1 | 1,
) {
  const nextIndex = index + direction;
  if (index < 0 || index >= photos.length) return photos;
  if (nextIndex < 0 || nextIndex >= photos.length) return photos;

  const next = [...photos];
  const selected = next[index]!;
  next[index] = next[nextIndex]!;
  next[nextIndex] = selected;
  return next;
}

export function removePostPhoto<T extends { id: string }>(
  photos: readonly T[],
  id: string,
) {
  return photos.filter((photo) => photo.id !== id);
}
