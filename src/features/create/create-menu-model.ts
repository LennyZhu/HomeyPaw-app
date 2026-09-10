export const primaryCreateActions = [
  {
    destination: { href: '/posts/new', kind: 'route' },
    icon: 'book-outline',
    id: 'journal',
    labelKey: 'create.menu.journal',
  },
  {
    destination: { href: '/create?mode=care', kind: 'route' },
    icon: 'heart-outline',
    id: 'care',
    labelKey: 'create.menu.care',
  },
  {
    destination: { href: '/reminders/new', kind: 'route' },
    icon: 'notifications-outline',
    id: 'reminder',
    labelKey: 'create.menu.reminder',
  },
  {
    destination: { href: '/schedule/new', kind: 'route' },
    icon: 'calendar-outline',
    id: 'schedule',
    labelKey: 'create.menu.schedule',
  },
] as const;
