import type { ModalProps } from 'react-native';
import { Platform } from 'react-native';

export const appScreenOrientation =
  Platform.OS === 'ios' && Platform.isPad
    ? ('all' as const)
    : ('portrait' as const);

export const modalSupportedOrientations: NonNullable<
  ModalProps['supportedOrientations']
> =
  Platform.OS === 'ios' && Platform.isPad
    ? ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']
    : ['portrait'];
