import { File } from 'expo-file-system';

export function removePostPhotoEditTemp(uri: string | null | undefined) {
  if (!uri) return;

  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Temporary edits are cache files. Cleanup must never discard form state.
  }
}
