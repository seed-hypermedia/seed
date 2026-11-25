import {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, pathMatches} from '../utils/entity-id-url'

/**
 * A user-created pin inside a single site's file explorer.
 * Pins live in the desktop app store and are keyed by the site UID + path.
 */
export interface PinnedDocument {
  /** Site the pin belongs to (UID of the site root). */
  siteUid: string
  /** Path within the site; empty for the site root. */
  path: string[]
  /** Version seen when the pin was created or last acknowledged. */
  seenVersion: string | null
  /** Title captured at pin time, so deleted pins still render a label. */
  title: string
  createdAt: string
}

/** Status of a pinned document relative to the current directory listing. */
export type PinStatus = 'ok' | 'outdated' | 'deleted'

/** A pin matched against a directory entry, if found, with its derived status. */
export type ResolvedPin = {
  pin: PinnedDocument
  item: HMDocumentInfo | undefined
  status: PinStatus
}

/**
 * Returns a stable identifier for a pin based on its site and path.
 */
export function pinnedDocumentId(pin: PinnedDocument): string {
  return `${pin.siteUid}:${pin.path.join('/')}`
}

/**
 * Resolves each pin against a directory listing to determine whether it is
 * up to date, outdated, or deleted.
 */
export function resolvePins(pins: PinnedDocument[], directoryItems: HMDocumentInfo[] | undefined): ResolvedPin[] {
  return pins.map((pin) => {
    const found = directoryItems?.find((item) => {
      return item.id.uid === pin.siteUid && pathMatches(item.id.path || [], pin.path)
    })
    if (!found) return {pin, item: undefined, status: 'deleted'}
    if (found.version !== pin.seenVersion) return {pin, item: found, status: 'outdated'}
    return {pin, item: found, status: 'ok'}
  })
}

/**
 * Creates a normalized UnpackedHypermediaId from a pin.
 */
export function pinnedDocumentToUnpackedId(pin: PinnedDocument): UnpackedHypermediaId {
  return hmId(pin.siteUid, {
    path: pin.path,
    version: pin.seenVersion,
  })
}
