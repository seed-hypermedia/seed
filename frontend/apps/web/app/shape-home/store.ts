import {type ShapeHomePersisted, type ShapeHomeSiteRecord} from '@shm/shared/models/shape-home-machines'
import {useSyncExternalStore} from 'react'

const STORAGE_KEY = 'ShapeHomeState-v001'

/** The persisted Shape Home state as stored in localStorage. */
export type ShapeHomeBrowserState = ShapeHomePersisted

const EMPTY_STATE: ShapeHomePersisted = {sites: {}}
const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedState: ShapeHomePersisted = EMPTY_STATE

function parse(raw: string | null): ShapeHomePersisted {
  if (!raw) return EMPTY_STATE
  try {
    const parsed = JSON.parse(raw) as ShapeHomePersisted
    if (!parsed || typeof parsed !== 'object' || !parsed.sites || typeof parsed.sites !== 'object') return EMPTY_STATE
    return {modalDone: parsed.modalDone, sites: parsed.sites}
  } catch {
    return EMPTY_STATE
  }
}

/** Reads the persisted Shape Home state from localStorage. Corrupted/missing → empty. */
export function readShapeHomeState(): ShapeHomePersisted {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return EMPTY_STATE
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedState = parse(raw)
  }
  return cachedState
}

/** Writes the persisted Shape Home state to localStorage and notifies subscribers. Storage failure = no-op. */
export function writeShapeHomeState(state: ShapeHomePersisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage failures; the feature degrades to behaving as empty.
  }
  listeners.forEach((listener) => listener())
}

/** Returns the record for a site uid, or undefined. */
export function getShapeHomeSiteRecord(state: ShapeHomePersisted, uid: string): ShapeHomeSiteRecord | undefined {
  return state.sites[uid]
}

/** Persists a site record. */
export function persistShapeHomeSiteRecord(uid: string, record: ShapeHomeSiteRecord): void {
  const state = readShapeHomeState()
  writeShapeHomeState({...state, sites: {...state.sites, [uid]: record}})
}

/** Persists that the one-time modal was answered in this browser. */
export function persistShapeHomeModalDone(): void {
  writeShapeHomeState({...readShapeHomeState(), modalDone: true})
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Subscribes to the persisted Shape Home state, including writes from other tabs. */
export function useShapeHomeBrowserState(): ShapeHomePersisted {
  return useSyncExternalStore(subscribe, readShapeHomeState, () => EMPTY_STATE)
}
