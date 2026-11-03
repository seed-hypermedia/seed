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
  web: [
    'home',
    'article',
    'article-discussion',
    'notes-table',
    'notes-list',
    'notes-cards',
    'search-command',
    'not-found',
  ],
  vault: ['first-screen', 'signup-password', 'recovery-words', 'sign-in'],
  desktop: [
    'library-home',
    'article',
    'new-draft-slash-menu',
    'activity-feed',
    'comments',
    'settings-general',
    'settings-appearance',
    'site-settings',
    'account-menu',
    'search-quick-switcher',
    'onboarding',
  ],
} as const

/** A supported color mode. */
export type CaptureTheme = (typeof CAPTURE_THEMES)[number]
/** A supported screenshot viewport. */
export type CaptureViewport = keyof typeof CAPTURE_VIEWPORTS
/** One successful screenshot recorded in the manifest. */
export type CaptureRecord = {
  view: string
  theme: CaptureTheme
  viewport: CaptureViewport
  file: string
  url: string
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
  return {commit, createdAt, surfaces: {}, failures: []}
}

/** Return the stable view list for a static surface. */
export function captureViews(surface: keyof typeof CAPTURE_VIEWS): readonly string[] {
  return CAPTURE_VIEWS[surface]
}
