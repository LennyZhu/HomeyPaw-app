import type { ComponentProps } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Screen } from './screen';

// A native sheet owns its safe-area coordinate space (different from its presenter).
export function ModalScreen(props: ComponentProps<typeof Screen>) {
  return (
    <SafeAreaProvider>
      <Screen contentWidth="modal" modal scroll {...props} />
    </SafeAreaProvider>
  );
}
