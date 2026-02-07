/**
 * Persistent store for WXR import progress tracking.
 * Uses electron-store for persistence across app restarts.
 */
// @ts-expect-error - mts import
import {appStore} from './app-store.mts'
import {SeedImportData, SeedImportFileV1} from './wxr-crypto'
import type {ImportResults} from './wxr-import'

const IMPORT_STATE_KEY = 'wxr-import-state'
const IMPORT_FILE_KEY = 'wxr-import-file'

export interface WXRImportState {
  // Unique import session ID.
  importId: string

  // Whether this is an "authored" import (with crypto keys).
  isAuthored: boolean

  // Destination space info.
  destinationUid: string
  destinationPath: string[]

  // Publisher's signing key name.
  publisherKeyName: string

  // Whether to overwrite existing documents at same path.
  overwriteExisting: boolean

  // Progress tracking.
  phase: 'pending' | 'authors' | 'posts' | 'complete' | 'error'
  totalPosts: number
  importedPosts: number
  lastImportedPostId?: number
  error?: string

  // Import results (populated on completion).
  results?: ImportResults

  // Timestamp of last activity.
  lastUpdated: number
}

/**
 * Get the current import state, if any.
 */
export function getImportState(): WXRImportState | null {
  const state = appStore.get(IMPORT_STATE_KEY)
  return state || null
}

/**
 * Save the import state.
 */
export function setImportState(state: WXRImportState): void {
  state.lastUpdated = Date.now()
  appStore.set(IMPORT_STATE_KEY, state)
}

/**
 * Clear the import state.
 */
export function clearImportState(): void {
  appStore.delete(IMPORT_STATE_KEY)
  appStore.delete(IMPORT_FILE_KEY)
}

/**
 * Get the stored import file data.
 */
export function getImportFile(): SeedImportFileV1 | null {
  const file = appStore.get(IMPORT_FILE_KEY)
  return file || null
}

/**
 * Save the import file data.
 */
export function setImportFile(file: SeedImportFileV1): void {
  appStore.set(IMPORT_FILE_KEY, file)
}

/**
 * Update progress in both state and import data.
 */
export function updateImportProgress(
  postId: number,
  importedCount: number,
): void {
  const state = getImportState()
  if (state) {
    state.importedPosts = importedCount
    state.lastImportedPostId = postId
    setImportState(state)
  }
}

/**
 * Mark import as complete with results.
 */
export function markImportComplete(results?: ImportResults): void {
  const state = getImportState()
  if (state) {
    state.phase = 'complete'
    state.results = results
    setImportState(state)
  }
}

/**
 * Mark import as failed.
 */
export function markImportError(error: string): void {
  const state = getImportState()
  if (state) {
    state.phase = 'error'
    state.error = error
    setImportState(state)
  }
}

/**
 * Check if there's an active import that can be resumed.
 */
export function hasResumableImport(): boolean {
  const state = getImportState()
  if (!state) return false

  // Only resumable if not complete or errored.
  return state.phase !== 'complete' && state.phase !== 'error'
}

/**
 * Calculate remaining posts to import.
 */
export function getRemainingPosts(
  data: SeedImportData,
): SeedImportData['posts'] {
  return data.posts.filter((p) => !p.imported)
}
