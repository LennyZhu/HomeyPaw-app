// A small focus bridge for the module-level notification handler. This holds
// no messages, tokens, unread state or persisted data.
type FocusedChat = { familyId: string; userId: string } | null;
let focusedChat: FocusedChat = null;

export function setFocusedChatForPush(scope: FocusedChat) {
  focusedChat = scope;
}

export function shouldSuppressChatPush(
  data: Record<string, unknown>,
  appState: string,
  scope: FocusedChat = focusedChat,
) {
  return (
    appState === 'active' &&
    scope !== null &&
    data.type === 'chat_message' &&
    data.familyId === scope.familyId
  );
}
