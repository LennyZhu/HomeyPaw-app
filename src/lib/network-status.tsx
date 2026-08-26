import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/app-text';
import { lightColors, radius, shadows, spacing } from '@/theme';

type ConnectionNotice = 'offline' | 'reconnected' | null;

export function NetworkStatusProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<ConnectionNotice>(null);
  const wasOnline = useRef<boolean | null>(null);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;

      onlineManager.setOnline(online);

      if (!online) {
        if (recoveryTimer.current) {
          clearTimeout(recoveryTimer.current);
          recoveryTimer.current = null;
        }
        setNotice('offline');
      } else if (wasOnline.current === false) {
        setNotice('reconnected');
        recoveryTimer.current = setTimeout(() => {
          setNotice(null);
          recoveryTimer.current = null;
        }, 2500);
      } else {
        setNotice(null);
      }

      wasOnline.current = online;
    });

    return () => {
      unsubscribe();
      if (recoveryTimer.current) {
        clearTimeout(recoveryTimer.current);
      }
    };
  }, []);

  return (
    <View style={styles.root}>
      {children}
      {notice ? (
        <SafeAreaView
          edges={['top']}
          pointerEvents="none"
          style={styles.bannerLayer}
        >
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={[
              styles.banner,
              notice === 'offline' ? styles.offline : styles.reconnected,
            ]}
          >
            <AppText
              tone={notice === 'offline' ? 'onPrimary' : 'primary'}
              variant="subheadline"
            >
              {t(`network.${notice}`)}
            </AppText>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bannerLayer: {
    alignItems: 'center',
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    top: 0,
    zIndex: 1000,
  },
  banner: {
    alignItems: 'center',
    borderRadius: radius.full,
    marginTop: spacing.xs,
    maxWidth: 420,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.floating,
  },
  offline: { backgroundColor: lightColors.error },
  reconnected: { backgroundColor: lightColors.secondarySoft },
});
