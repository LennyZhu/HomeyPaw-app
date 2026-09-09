export type ReminderCompletionNavigation =
  { kind: 'back' } | { href: string; kind: 'replace' };

export function getNewReminderCompletionNavigation({
  canGoBack,
  returnTo,
}: {
  canGoBack: boolean;
  returnTo?: string | null | undefined;
}): ReminderCompletionNavigation {
  if (returnTo && /^\/schedule(?:[/?]|$)/u.test(returnTo)) {
    return { href: returnTo, kind: 'replace' };
  }

  return canGoBack ? { kind: 'back' } : { href: '/reminders', kind: 'replace' };
}

export function getReminderFormCancelNavigation(
  canGoBack: boolean,
  fallback: string,
): ReminderCompletionNavigation {
  return canGoBack ? { kind: 'back' } : { href: fallback, kind: 'replace' };
}
