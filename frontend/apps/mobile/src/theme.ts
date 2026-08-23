/**
 * Design tokens mirroring the web app's DARK theme
 * (frontend/packages/ui/src/theme.css `.dark`), so shared surfaces —
 * document cards above all — look the same on mobile as on the web.
 */
export const theme = {
  background: '#171717',
  foreground: '#e5e5e5',
  card: '#000000',
  border: '#262626',
  muted: '#262626',
  mutedForeground: '#a3a3a3',
  accent: '#00473d',
  accentForeground: '#ffffff',
  brand: '#1c9c8f',
  /** Placeholder thumbnail (emerald-900 @ 30% over the card). */
  placeholderBg: '#123529',
  placeholderIcon: '#34d399',
  danger: '#ff6b6b',
} as const

/** Web `shadow-md`, approximated for RN. */
export const shadowMd = {
  shadowColor: '#000',
  shadowOpacity: 0.1,
  shadowOffset: {width: 0, height: 4},
  shadowRadius: 8,
  elevation: 3,
} as const

/** Web radius scale (--radius: 0.375rem). */
export const radius = {
  sm: 2,
  md: 4,
  lg: 6,
  xl: 10,
  full: 9999,
} as const
