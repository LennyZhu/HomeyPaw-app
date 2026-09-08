import {
  ImageManipulator,
  SaveFormat,
  type ImageResult,
} from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PreparedAvatarImage = Pick<
  ImageResult,
  'base64' | 'height' | 'uri' | 'width'
>;

export async function hasAvatarImagePermission() {
  const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
  return permission.granted;
}

export async function pickAndPrepareAvatarImage() {
  let permission = await ImagePicker.getMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  }

  if (!permission.granted) {
    throw new Error('PHOTO_PERMISSION_DENIED');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: true,
    aspect: [1, 1],
    mediaTypes: ['images'],
    quality: 1,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) throw new Error('PHOTO_SELECTION_EMPTY');

  const squareSize = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  context
    .crop({
      height: squareSize,
      originX: Math.max(0, (asset.width - squareSize) / 2),
      originY: Math.max(0, (asset.height - squareSize) / 2),
      width: squareSize,
    })
    .resize({ height: 1024, width: 1024 });

  const rendered = await context.renderAsync();
  return rendered.saveAsync({
    base64: true,
    compress: 0.82,
    format: SaveFormat.JPEG,
  });
}
