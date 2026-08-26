import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { lightColors, radius, shadows, spacing } from '@/theme';

import { AppText } from './app-text';

type FeedbackTone = 'success' | 'error' | 'info';
type FeedbackContextValue = {
  showFeedback: (message: string, tone?: FeedbackTone) => void;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: PropsWithChildren) {
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: FeedbackTone;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback(
    (message: string, tone: FeedbackTone = 'success') => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      setFeedback({ message, tone });
      timer.current = setTimeout(
        () => {
          setFeedback(null);
          timer.current = null;
        },
        tone === 'error' ? 4500 : 2800,
      );
    },
    [],
  );

  const value = useMemo(() => ({ showFeedback }), [showFeedback]);

  return (
    <FeedbackContext value={value}>
      <View style={styles.root}>
        {children}
        {feedback ? (
          <SafeAreaView
            edges={['bottom']}
            pointerEvents="none"
            style={styles.layer}
          >
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={[styles.toast, styles[feedback.tone]]}
            >
              <AppText
                tone={feedback.tone === 'error' ? 'onPrimary' : 'primary'}
                variant="subheadline"
              >
                {feedback.message}
              </AppText>
            </View>
          </SafeAreaView>
        ) : null}
      </View>
    </FeedbackContext>
  );
}

export function useFeedback() {
  const value = use(FeedbackContext);
  if (!value) {
    throw new Error('useFeedback must be used within FeedbackProvider');
  }
  return value;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layer: {
    alignItems: 'center',
    bottom: spacing.lg,
    left: spacing.lg,
    position: 'absolute',
    right: spacing.lg,
    zIndex: 1100,
  },
  toast: {
    borderRadius: radius.full,
    maxWidth: 440,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    ...shadows.floating,
  },
  success: { backgroundColor: lightColors.secondarySoft },
  info: { backgroundColor: lightColors.primarySoft },
  error: { backgroundColor: lightColors.error },
});
