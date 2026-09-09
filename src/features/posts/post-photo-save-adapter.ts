import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { Platform } from 'react-native';

import {
  getPostPhotoFileExtension,
  type PostPhotoSaveDependencies,
} from './post-photo-save';

export const canSavePostPhotoToLibrary =
  Platform.OS === 'ios' || Platform.OS === 'android';

export const postPhotoSaveDependencies: PostPhotoSaveDependencies = {
  isSupported: () => canSavePostPhotoToLibrary,
  requestWritePermission: async () => {
    const permission = await requestPermissionsAsync(true, ['photo']);
    return {
      canAskAgain: permission.canAskAgain,
      granted: permission.granted,
    };
  },
  downloadAuthorizedPhoto: async (photo) => {
    const extension = getPostPhotoFileExtension(photo.mimeType);
    const destination = new File(
      Paths.cache,
      `homeypaw-photo-${photo.id}-${Date.now()}.${extension}`,
    );

    try {
      const downloadedPhoto = await File.downloadFileAsync(
        photo.authorizedUrl,
        destination,
      );
      return {
        cleanup: () => {
          if (downloadedPhoto.exists) downloadedPhoto.delete();
        },
        uri: downloadedPhoto.uri,
      };
    } catch (error) {
      if (destination.exists) destination.delete();
      throw error;
    }
  },
  addToPhotoLibrary: async (uri) => {
    await Asset.create(uri);
  },
};
