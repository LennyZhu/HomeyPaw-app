export type PostPhotoSaveRequest = {
  authorizedUrl: string;
  id: string;
  mimeType: string;
};

export type PostPhotoSaveResult =
  | 'busy'
  | 'failed'
  | 'permission-blocked'
  | 'permission-denied'
  | 'saved'
  | 'unsupported';

type PhotoLibraryPermission = {
  canAskAgain: boolean;
  granted: boolean;
};

type TemporaryPostPhoto = {
  cleanup: () => Promise<void> | void;
  uri: string;
};

export type PostPhotoSaveDependencies = {
  addToPhotoLibrary: (uri: string) => Promise<void>;
  downloadAuthorizedPhoto: (
    photo: PostPhotoSaveRequest,
  ) => Promise<TemporaryPostPhoto>;
  isSupported: () => boolean;
  requestWritePermission: () => Promise<PhotoLibraryPermission>;
};

type ViewerPostPhoto = {
  id: string;
  mime_type: string;
  storage_path: string;
};

export function getCurrentPostPhoto(
  media: ViewerPostPhoto[],
  mediaUrls: Record<string, string>,
  currentIndex: number,
): PostPhotoSaveRequest | null {
  const currentPhoto = media[currentIndex];
  if (!currentPhoto) return null;

  const authorizedUrl = mediaUrls[currentPhoto.storage_path];
  if (!authorizedUrl) return null;

  return {
    authorizedUrl,
    id: currentPhoto.id,
    mimeType: currentPhoto.mime_type,
  };
}

export function getPostPhotoFileExtension(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

export function createPostPhotoSaver(dependencies: PostPhotoSaveDependencies) {
  let isSaving = false;

  return async function savePostPhoto(
    photo: PostPhotoSaveRequest,
  ): Promise<PostPhotoSaveResult> {
    if (!dependencies.isSupported()) return 'unsupported';
    if (isSaving) return 'busy';

    isSaving = true;
    let temporaryPhoto: TemporaryPostPhoto | null = null;

    try {
      const permission = await dependencies.requestWritePermission();
      if (!permission.granted) {
        return permission.canAskAgain
          ? 'permission-denied'
          : 'permission-blocked';
      }

      temporaryPhoto = await dependencies.downloadAuthorizedPhoto(photo);
      await dependencies.addToPhotoLibrary(temporaryPhoto.uri);
      return 'saved';
    } catch {
      return 'failed';
    } finally {
      if (temporaryPhoto) {
        try {
          await temporaryPhoto.cleanup();
        } catch {
          // The OS may already have evicted this cache file.
        }
      }
      isSaving = false;
    }
  };
}
