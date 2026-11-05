import { contentStyles } from '@/components/content-container';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { lightColors, layout, spacing } from '@/theme';

type AuthScreenProps = PropsWithChildren<{
  subtitle?: string;
  title: string;
  footer?: ReactNode;
  onBrandPress?: () => void;
}>;

export function AuthScreen({
  children,
  footer,
  onBrandPress,
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
            {onBrandPress ? (
              <Pressable
                accessibilityLabel="HomeyPaw"
                accessibilityRole="button"
                hitSlop={12}
                onPress={onBrandPress}
                style={styles.brandAction}
              >
                <AppText tone="brand" variant="headline">
                  HomeyPaw
                </AppText>
              </Pressable>
            ) : (
              <AppText tone="brand" variant="headline">
                HomeyPaw
              </AppText>
            )}
            <AppText accessibilityRole="header" variant="largeTitle">
              {title}
            </AppText>
            {subtitle ? (
              <AppText style={styles.subtitle} tone="secondary">
                {subtitle}
              </AppText>
            ) : null}
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
    ...contentStyles.auth,
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.huge,
    paddingTop: spacing.xxxl,
  },
  brand: {
    gap: spacing.sm,
  },
  brandAction: {
    alignSelf: 'flex-start',
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
