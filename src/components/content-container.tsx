import {
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native';

import { layout } from '@/theme';

import { contentMaxWidth, type ContentWidth } from '@/theme/layout';
export type { ContentWidth } from '@/theme/layout';

export function useContentLayout(variant: ContentWidth = 'readable') {
  const { width, height, fontScale } = useWindowDimensions();
  return {
    isWide: width >= layout.tabletBreakpoint,
    width,
    height,
    fontScale,
    containerStyle: { maxWidth: contentMaxWidth(width, variant) },
  };
}

export function ContentContainer({
  variant = 'readable',
  style,
  ...props
}: ViewProps & { variant?: ContentWidth }) {
  const { containerStyle } = useContentLayout(variant);
  return (
    <View {...props} style={[contentStyles.base, containerStyle, style]} />
  );
}

// Shared with virtualized lists: no extra scroll view or change to list identity.
export const contentStyles = StyleSheet.create({
  base: { width: '100%', alignSelf: 'center' },
  readable: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  modal: { width: '100%', maxWidth: layout.modalMaxWidth, alignSelf: 'center' },
  auth: { width: '100%', maxWidth: layout.authMaxWidth, alignSelf: 'center' },
});
