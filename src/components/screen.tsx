import type { PropsWithChildren } from 'react';
import type { ScrollViewProps, StyleProp, ViewStyle } from 'react-native';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { lightColors, layout, spacing } from '@/theme';
import {
  contentStyles,
  useContentLayout,
  type ContentWidth,
} from './content-container';

type ScreenProps = PropsWithChildren<{
  contentContainerStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  refreshControl?: ScrollViewProps['refreshControl'];
  contentWidth?: ContentWidth;
  modal?: boolean;
}>;

export function Screen({
  children,
  contentContainerStyle,
  scroll = false,
  style,
  keyboardShouldPersistTaps = 'handled',
  refreshControl,
  contentWidth = 'readable',
  modal = false,
}: ScreenProps) {
  const { containerStyle } = useContentLayout(contentWidth);
  return (
    <SafeAreaView
      edges={
        modal ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']
      }
      style={[styles.safeArea, style]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={[
              styles.contentBase,
              contentStyles.base,
              containerStyle,
              styles.scrollContent,
              contentContainerStyle,
            ]}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            keyboardDismissMode={
              Platform.OS === 'ios' ? 'interactive' : 'on-drag'
            }
            refreshControl={refreshControl}
            showsVerticalScrollIndicator={false}
            style={styles.scrollView}
          >
            {children}
          </ScrollView>
        ) : (
          <View
            style={[
              styles.contentBase,
              contentStyles.base,
              containerStyle,
              styles.staticContent,
              contentContainerStyle,
            ]}
          >
            {children}
          </View>
        )}
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
  contentBase: {
    paddingHorizontal: layout.screenPadding,
  },
  staticContent: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.huge,
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
});
