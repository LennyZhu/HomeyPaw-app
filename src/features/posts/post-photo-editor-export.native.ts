import { PixelRatio, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { getPhotoEditorExportSize } from './photo-editor-state';

export async function exportPostPhotoCanvas(
  canvas: View,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const sourceLongestEdge = Math.min(2048, Math.max(sourceWidth, sourceHeight));
  const target = getPhotoEditorExportSize(
    canvasWidth,
    canvasHeight,
    sourceLongestEdge,
  );
  const pixelRatio = PixelRatio.get();
  const uri = await captureRef(canvas, {
    format: 'png',
    height: target.height / pixelRatio,
    quality: 1,
    result: 'tmpfile',
    width: target.width / pixelRatio,
  });

  return { ...target, uri };
}
