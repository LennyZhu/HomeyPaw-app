import {
  DefaultTheme,
  type ErrorBoundaryProps,
  Stack,
  ThemeProvider,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { LoadingView } from '@/components/loading-view';
import { GlobalErrorScreen } from '@/components/global-error-screen';
import { FeedbackProvider } from '@/components/feedback-provider';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { AuthDeepLinkCoordinator } from '@/features/auth/auth-deep-link-coordinator';
import { CareTaskNotificationCoordinator } from '@/features/reminders/care-task-notification-coordinator';
import i18n from '@/i18n';
import { AppQueryClientProvider } from '@/lib/query-client';
import { NetworkStatusProvider } from '@/lib/network-status';
import { lightColors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: lightColors.background,
    border: lightColors.border,
    card: lightColors.surface,
    notification: lightColors.primary,
    primary: lightColors.primary,
    text: lightColors.textPrimary,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={navigationTheme}>
      <AppQueryClientProvider>
        <NetworkStatusProvider>
          <FeedbackProvider>
            <AuthProvider>
              <RootNavigator />
            </AuthProvider>
          </FeedbackProvider>
        </NetworkStatusProvider>
      </AppQueryClientProvider>
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <GlobalErrorScreen error={error} retry={retry} />;
}

function RootNavigator() {
  const {
    hasPasswordRecoveryError,
    isPasswordRecovery,
    isProcessingAuthCallback,
    isRestoring,
    session,
  } = useAuth();

  useEffect(() => {
    if (!isRestoring) {
      void SplashScreen.hideAsync();
    }
  }, [isRestoring]);

  if (isRestoring) {
    return <LoadingView label={i18n.t('auth.restoringSession')} />;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected
          guard={Boolean(
            hasPasswordRecoveryError ||
            isPasswordRecovery ||
            isProcessingAuthCallback,
          )}
        >
          <Stack.Screen
            name="reset-password"
            options={{ gestureEnabled: false }}
          />
        </Stack.Protected>
        <Stack.Protected
          guard={Boolean(
            session && !isPasswordRecovery && !isProcessingAuthCallback,
          )}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="edit-profile" />
          <Stack.Screen name="account-security" />
          <Stack.Screen name="about" />
          <Stack.Screen name="privacy-policy" />
          <Stack.Screen name="terms-of-service" />
          <Stack.Screen name="join-family" />
          <Stack.Screen name="reminders" />
          <Stack.Screen name="pets" />
          <Stack.Screen name="posts" />
          <Stack.Screen name="care" />
        </Stack.Protected>
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="chat-preview" />
        </Stack.Protected>
        <Stack.Protected
          guard={Boolean(
            !session &&
            !hasPasswordRecoveryError &&
            !isPasswordRecovery &&
            !isProcessingAuthCallback,
          )}
        >
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
      <AuthDeepLinkCoordinator />
      <CareTaskNotificationCoordinator />
      <StatusBar style="dark" />
    </>
  );
}
