import type { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { lightColors, layout, spacing } from '@/theme';

type AuthScreenProps = PropsWithChildren<{
  subtitle: string;
  title: string;
  footer?: ReactNode;
}>;

export function AuthScreen({
  children,
  footer,
  subtitle,
  title,
}: AuthScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <AppText tone="brand" variant="headline">
              HomeyPaw
            </AppText>
            <AppText accessibilityRole="header" variant="largeTitle">
              {title}
            </AppText>
            <AppText style={styles.subtitle} tone="secondary">
              {subtitle}
            </AppText>
          </View>

          <View style={styles.form}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    width: '100%',
    maxWidth: Math.min(layout.contentMaxWidth, 520),
    alignSelf: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.huge,
    paddingTop: spacing.xxxl,
  },
  brand: {
    gap: spacing.sm,
  },
  subtitle: {
    maxWidth: 360,
  },
  form: {
    gap: spacing.lg,
    marginTop: spacing.huge,
  },
  footer: {
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
});
