export const layout = {
  screenPadding: 20,
  sectionGap: 32,
  contentMaxWidth: 720,
  tabletBreakpoint: 768,
  scheduleMaxWidth: 960,
  modalMaxWidth: 560,
  authMaxWidth: 520,
  minimumTouchTarget: 44,
  tabBarBaseHeight: 52,
} as const;

export type ContentWidth = 'readable' | 'schedule' | 'modal' | 'auth';

// Window width, never device identity: narrow iPad windows use the phone layout.
export function contentMaxWidth(
  width: number,
  variant: ContentWidth = 'readable',
) {
  if (variant === 'modal') return layout.modalMaxWidth;
  if (variant === 'auth') return layout.authMaxWidth;
  return variant === 'schedule' && width >= layout.tabletBreakpoint
    ? layout.scheduleMaxWidth
    : layout.contentMaxWidth;
}
