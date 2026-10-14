import type { SVGProps } from 'react';

// Every path below is copied from the app's own markup (renderer/index.html
// and the pages), so an icon in a design is the icon the app draws.
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /></>,
  ladder: <path d="M7 3v18M17 3v18M7 8h10M7 13h10M7 18h10" />,
  leagues: <><path d="M3 9H21M7 3V5M17 3V5M6 13H8M6 17H8M11 13H13M11 17H13M16 13H18M16 17H18" /><rect x="3" y="5" width="18" height="16" rx="2" /></>,
  trophy: <><path d="M6 3H18V9C18 12.3137 15.3137 15 12 15C8.68629 15 6 12.3137 6 9V3Z" /><path d="M12 15V20M8 20H16M6 7H3C3 10 4.5 12 6 12M18 7H21C21 10 19.5 12 18 12" /></>,
  ticket: <path d="M4 6a2 2 0 00-2 2v1.5a2.5 2.5 0 010 5V16a2 2 0 002 2h16a2 2 0 002-2v-1.5a2.5 2.5 0 010-5V8a2 2 0 00-2-2H4zM9 6v3M9 11v2M9 15v3" />,
  court: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5M16 4v5" /><circle cx="12" cy="15" r="2" fill="currentColor" stroke="none" /></>,
  players: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6" /></>,
  activity: <path d="M2 15l3.5-4.5 2 2.5 3-9 3.5 12 3.5-9 3 3" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6.5V12L16 14" /></>,
  settings: <><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  back: <path d="M19 12H5M12 5l-7 7 7 7" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
  logout: <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />,
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />,
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** Which of the app's icons to draw. */
  name: IconName;
  /** Stroke width. The sidebar draws at 1.9; buttons and inline icons at 2. */
  strokeWidth?: number;
}

/**
 * One of the app's line icons: 24px grid, stroked with currentColor, no fill.
 * Size comes from where it sits - `.btn` sizes it to 14px, `.nav-icon` to 17px,
 * `.meta-row` to 14px - so pass `width`/`height` only when it stands alone.
 */
export function Icon({ name, strokeWidth = 2, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
