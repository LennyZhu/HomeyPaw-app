export type ReminderCompletionNavigation =
  { kind: 'back' } | { href: string; kind: 'replace' };

export function getNewReminderCompletionNavigation({
  canGoBack,
  returnTo,
  source,
}: {
  canGoBack: boolean;
  returnTo?: string | null | undefined;
  source?: string | null | undefined;
}): ReminderCompletionNavigation {
  if (returnTo && /^\/schedule(?:[/?]|$)/u.test(returnTo)) {
    return source === 'schedule' && canGoBack
      ? { kind: 'back' }
      : { href: returnTo, kind: 'replace' };
  }

  return canGoBack ? { kind: 'back' } : { href: '/reminders', kind: 'replace' };
}

export function getReminderFormCancelNavigation(
  canGoBack: boolean,
  fallback: string,
): ReminderCompletionNavigation {
  return canGoBack ? { kind: 'back' } : { href: fallback, kind: 'replace' };
}
