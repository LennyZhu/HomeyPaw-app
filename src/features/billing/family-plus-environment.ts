import { supabaseEnvironment } from '@/lib/supabase/environment';
import { canUseFamilyPlusPreview } from './family-plus-preview';

export const isFamilyPlusSandbox = () => supabaseEnvironment.sandbox;
export const isFamilyPlusRelease = () =>
  !__DEV__ &&
  process.env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET === 'production' &&
  process.env.EXPO_PUBLIC_FAMILY_PLUS_RELEASE_ENABLED === 'true' &&
  supabaseEnvironment.url === 'https://tknaobmlwmodsqtpqwkr.supabase.co';
export const isFamilyPlusAvailable = () =>
  isFamilyPlusSandbox() ||
  isFamilyPlusRelease() ||
  canUseFamilyPlusPreview(__DEV__, supabaseEnvironment.url);
