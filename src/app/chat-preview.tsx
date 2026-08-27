import { Redirect } from 'expo-router';

import ChatPreviewScreen from '@/features/chat/chat-preview-screen';

export default function ChatPreviewRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return <ChatPreviewScreen />;
}
