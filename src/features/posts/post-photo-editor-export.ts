import type { View } from 'react-native';

export async function exportPostPhotoCanvas(
  _canvas: View,
  _sourceWidth: number,
  _sourceHeight: number,
  _canvasWidth: number,
  _canvasHeight: number,
): Promise<{ height: number; uri: string; width: number }> {
  throw new Error('PHOTO_EDIT_EXPORT_UNAVAILABLE');
}
