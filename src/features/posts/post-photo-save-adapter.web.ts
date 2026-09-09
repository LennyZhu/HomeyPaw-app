import type { PostPhotoSaveDependencies } from './post-photo-save';

export const canSavePostPhotoToLibrary = false;

const unsupported = async (): Promise<never> => {
  throw new Error('Saving to the system photo library is unavailable.');
};

export const postPhotoSaveDependencies: PostPhotoSaveDependencies = {
  addToPhotoLibrary: unsupported,
  downloadAuthorizedPhoto: unsupported,
  isSupported: () => false,
  requestWritePermission: unsupported,
};
