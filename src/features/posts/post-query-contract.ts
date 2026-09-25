import type { BackendCapability } from '@/features/family/backend-capability-state';

const legacyPetPostSelect = '*, post_media(*)';
const familyPostSelect = '*, post_media(*), post_videos(*)';

export function getPostSelect(capability: BackendCapability) {
  return capability === 'LEGACY_PET' ? legacyPetPostSelect : familyPostSelect;
}
