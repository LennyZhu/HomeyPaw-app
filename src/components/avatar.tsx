import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageProps } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { lightColors, radius } from '@/theme';

import { AppText } from './app-text';

type AvatarProps = {
  accessibilityLabel: string;
  name: string;
  size?: number;
  source?: ImageProps['source'];
  onError?: ImageProps['onError'];
};

export function Avatar({
  accessibilityLabel,
  name,
  size = 64,
  source,
  onError,
}: AvatarProps) {
  const dimensionStyle = { width: size, height: size, borderRadius: size / 2 };

  if (source) {
    return (
      <Image
        accessibilityLabel={accessibilityLabel}
        cachePolicy="memory-disk"
        contentFit="cover"
        source={source}
        style={dimensionStyle}
        transition={180}
        {...(onError ? { onError } : {})}
      />
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={[styles.fallback, dimensionStyle]}
    >
      {name ? (
        <AppText
          style={{ fontSize: size * 0.36, lineHeight: size * 0.46 }}
          tone="brand"
          variant="title2"
        >
          {name.slice(0, 1).toUpperCase()}
        </AppText>
      ) : (
        <Ionicons color={lightColors.primary} name="paw" size={size * 0.42} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
});
