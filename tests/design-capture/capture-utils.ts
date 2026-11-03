/** Color modes used by the cross-surface screenshot matrix. */
export const CAPTURE_THEMES = ['light', 'dark'] as const

/** CSS pixel dimensions for the named screenshot viewports. */
export const CAPTURE_VIEWPORTS = {
  desktop: {width: 1440, height: 900},
  mobile: {width: 390, height: 844},
} as const

/** Stable view names for surfaces whose capture set is known without inspecting the app. */
export const CAPTURE_VIEWS = {
  emails: ['verification', 'login', 'welcome', 'discussion', 'comment', 'mention', 'reply', 'doc-update'],
  web: ['home', 'article', 'article-discussion', 'notes-table', 'notes-list', 'notes-cards', 'not-found'],
  vault: [
    'first-screen',
    'verification-code',
    'auth-choice',
    'signup-password',
    'recovery-words',
    'signed-in',
    'sign-in',
  ],
  desktop: [
    'library-home',
    'article',
    'new-draft-slash-menu',
    'activity-feed',
    'comments',
    'settings-general',
    'site-settings',
    'account-menu',
    'search-quick-switcher',
  ],
} as const

/** A supported color mode. */
export type CaptureTheme = (typeof CAPTURE_THEMES)[number]
/** A supported screenshot viewport. */
export type CaptureViewport = keyof typeof CAPTURE_VIEWPORTS
/** A rectangle in CSS pixels. */
export type CaptureBounds = {x: number; y: number; width: number; height: number}
/** One successful screenshot recorded in the manifest. */
export type CaptureRecord = {
  view: string
  theme: CaptureTheme
  viewport: CaptureViewport
  file: string
  url: string
  note?: string
}

/** A view that could not be captured. */
export type CaptureFailure = {
  surface: string
  view: string
  theme?: CaptureTheme
  viewport?: CaptureViewport
  error: string
}

/** Machine-readable capture run metadata. */
export type CaptureManifest = {
  commit: string
  createdAt: string
  surfaces: Record<string, CaptureRecord[]>
  failures: CaptureFailure[]
  fonts: Record<string, {computedFontFamily: string; renderedFace: string}>
}

/** Union, pad, and clamp content rectangles to the screenshot viewport. */
export function unionCaptureBounds(
  bounds: readonly CaptureBounds[],
  viewport: {width: number; height: number},
  padding = 24,
): CaptureBounds | null {
  if (bounds.length === 0) return null

  const left = Math.min(...bounds.map((bound) => bound.x))
  const top = Math.min(...bounds.map((bound) => bound.y))
  const right = Math.max(...bounds.map((bound) => bound.x + bound.width))
  const bottom = Math.max(...bounds.map((bound) => bound.y + bound.height))
  const x = Math.max(0, left - padding)
  const y = Math.max(0, top - padding)
  const maxX = Math.min(viewport.width, right + padding)
  const maxY = Math.min(viewport.height, bottom + padding)

  if (maxX <= x || maxY <= y) return null
  return {x, y, width: maxX - x, height: maxY - y}
}

/** Normalize a view label for use in a screenshot filename. */
export function slugView(view: string): string {
  return view
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/** Build a screenshot path relative to the capture output directory. */
export function captureFileName(surface: string, view: string, theme: CaptureTheme, viewport: CaptureViewport): string {
  return `${surface}/${slugView(view)}--${theme}--${viewport}.png`
}

/** Create an empty manifest for one captured commit. */
export function createManifest(commit: string, createdAt: string): CaptureManifest {
  return {commit, createdAt, surfaces: {}, failures: [], fonts: {}}
}

/** Return the stable view list for a static surface. */
export function captureViews(surface: keyof typeof CAPTURE_VIEWS): readonly string[] {
  return CAPTURE_VIEWS[surface]
}
