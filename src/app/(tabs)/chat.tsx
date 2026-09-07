import { Redirect } from 'expo-router';

import { CHAT_ENABLED } from '@/config/features';
import ChatScreen from '@/features/chat/chat-screen';

export default function ChatRoute() {
  if (!CHAT_ENABLED) {
    return <Redirect href="/" />;
  }

  return <ChatScreen />;
}
