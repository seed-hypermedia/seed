/**
 * Client-side performance marks for web comment interactions.
 *
 * Uses the browser Performance API (performance.mark / performance.measure)
 * to track timing of user interactions. These marks are zero-cost in
 * production and can be read by Playwright or DevTools.
 *
 * Enable console logging with SEED_PERF_MARKS=1 env var (injected via Vite define).
 */

const PERF_MARKS = {
  // Panel interactions
  PANEL_OPEN_START: 'perf:panel-open-start',
  PANEL_OPEN_END: 'perf:panel-open-end',
  PANEL_OPEN: 'perf:panel-open',

  // Comment submission
  COMMENT_SUBMIT_START: 'perf:comment-submit-start',
  COMMENT_SUBMIT_END: 'perf:comment-submit-end',
  COMMENT_SUBMIT: 'perf:comment-submit',

  // Comment editor loading
  EDITOR_LOAD_START: 'perf:editor-load-start',
  EDITOR_LOAD_END: 'perf:editor-load-end',
  EDITOR_LOAD: 'perf:editor-load',

  // Navigation
  NAV_START: 'perf:nav-start',
  NAV_END: 'perf:nav-end',
  NAV: 'perf:nav',
} as const

/** Returns true when perf instrumentation is enabled (set by the test runner). */
export function isPerfEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && (window as any).__SEED_PERF_MARKS === true
  } catch {
    return false
  }
}

function safeMark(name: string): void {
  if (!isPerfEnabled()) return
  try {
    performance.mark(name)
  } catch {
    // Ignore errors in environments without Performance API
  }
}

function safeMeasure(name: string, startMark: string, endMark: string): PerformanceMeasure | undefined {
  if (!isPerfEnabled()) return undefined
  try {
    const measure = performance.measure(name, startMark, endMark)
    console.log(`[perf] ${name}: ${measure.duration.toFixed(1)}ms`)
    return measure
  } catch {
    return undefined
  }
}

function clearMarks(name: string): void {
  if (typeof performance === 'undefined') return
  try {
    performance.clearMarks(name)
  } catch {
    // Ignore
  }
}

// --- Panel open ---

export function markPanelOpenStart(): void {
  clearMarks(PERF_MARKS.PANEL_OPEN_START)
  safeMark(PERF_MARKS.PANEL_OPEN_START)
}

export function markPanelOpenEnd(): PerformanceMeasure | undefined {
  safeMark(PERF_MARKS.PANEL_OPEN_END)
  return safeMeasure(PERF_MARKS.PANEL_OPEN, PERF_MARKS.PANEL_OPEN_START, PERF_MARKS.PANEL_OPEN_END)
}

// --- Comment submit ---

export function markCommentSubmitStart(): void {
  clearMarks(PERF_MARKS.COMMENT_SUBMIT_START)
  safeMark(PERF_MARKS.COMMENT_SUBMIT_START)
}

export function markCommentSubmitEnd(): PerformanceMeasure | undefined {
  safeMark(PERF_MARKS.COMMENT_SUBMIT_END)
  return safeMeasure(PERF_MARKS.COMMENT_SUBMIT, PERF_MARKS.COMMENT_SUBMIT_START, PERF_MARKS.COMMENT_SUBMIT_END)
}

// --- Editor load ---

export function markEditorLoadStart(): void {
  clearMarks(PERF_MARKS.EDITOR_LOAD_START)
  safeMark(PERF_MARKS.EDITOR_LOAD_START)
}

export function markEditorLoadEnd(): PerformanceMeasure | undefined {
  safeMark(PERF_MARKS.EDITOR_LOAD_END)
  return safeMeasure(PERF_MARKS.EDITOR_LOAD, PERF_MARKS.EDITOR_LOAD_START, PERF_MARKS.EDITOR_LOAD_END)
}

// --- Navigation ---

export function markNavStart(): void {
  clearMarks(PERF_MARKS.NAV_START)
  safeMark(PERF_MARKS.NAV_START)
}

export function markNavEnd(): PerformanceMeasure | undefined {
  safeMark(PERF_MARKS.NAV_END)
  return safeMeasure(PERF_MARKS.NAV, PERF_MARKS.NAV_START, PERF_MARKS.NAV_END)
}

// --- Utility ---

/**
 * Get all perf measures collected during the session.
 * Useful for Playwright to read back results.
 */
export function getAllPerfMeasures(): PerformanceMeasure[] {
  if (typeof performance === 'undefined') return []
  try {
    return performance.getEntriesByType('measure').filter((e) => e.name.startsWith('perf:')) as PerformanceMeasure[]
  } catch {
    return []
  }
}

export {PERF_MARKS}
