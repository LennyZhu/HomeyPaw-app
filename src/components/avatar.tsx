import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { lightColors, radius } from '@/theme';

import { AppText } from './app-text';
import { getUserAvatarInitial } from './avatar-initial';

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
  const sourceKey = getSourceKey(source);
  const [failedSourceKey, setFailedSourceKey] = useState<string | null>(null);
  const fallbackInitial = getUserAvatarInitial(name);

  if (source && sourceKey !== failedSourceKey) {
    return (
      <Image
        accessibilityLabel={accessibilityLabel}
        cachePolicy="memory-disk"
        contentFit="cover"
        source={source}
        style={dimensionStyle}
        transition={180}
        onError={(event) => {
          setFailedSourceKey(sourceKey);
          onError?.(event);
        }}
      />
    );
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={[styles.fallback, dimensionStyle]}
    >
      <AppText
        style={{ fontSize: size * 0.36, lineHeight: size * 0.46 }}
        tone="brand"
        variant="title2"
      >
        {fallbackInitial}
      </AppText>
    </View>
  );
}

function getSourceKey(source: ImageProps['source']) {
  if (!source) return '';
  if (typeof source === 'string' || typeof source === 'number') {
    return String(source);
  }
  if (Array.isArray(source)) {
    return source
      .map((item) => (typeof item === 'object' ? item.uri : String(item)))
      .join('|');
  }
  return typeof source === 'object' && 'uri' in source
    ? String(source.uri ?? '')
    : String(source);
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    backgroundColor: lightColors.primarySoft,
    borderRadius: radius.full,
    justifyContent: 'center',
  },
});
