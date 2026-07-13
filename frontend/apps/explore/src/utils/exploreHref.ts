import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {commentIdToHmId, extractViewTermFromUrl, hmIdPathToEntityQueryPath, ViewTerm} from '@shm/shared'
import type {TabType} from '../components/Tabs'

/** True when the id points at an account's home/profile (no path segments). */
export function isProfileId(id: UnpackedHypermediaId): boolean {
  return !id.path?.filter((segment) => !!segment).length
}

/**
 * Maps a site view term (e.g. `/:comments`) to the Explore tab that represents
 * it. View terms without a distinct Explore tab — the remaining profile family
 * (`:membership`, `:followers`, `:following`) and `:feed`/`:activity` — resolve
 * to the resource's default document view.
 */
export function viewTermToExploreTab(viewTerm: ViewTerm | null): TabType | null {
  switch (viewTerm) {
    case ':profile':
      return 'profile'
    case ':comments':
    case ':comment':
    case ':discussions':
      return 'comments'
    case ':collaborators':
      return 'capabilities'
    case ':directory':
    case ':all-documents':
      return 'children'
    default:
      return null
  }
}

/**
 * Inverse of {@link viewTermToExploreTab}: the canonical view term for an
 * Explore tab, or null for explore-only tabs (Document State, Changes,
 * Versions, Citations, Authored Comments) that have no hypermedia view term and
 * are therefore selected via `?tab=` instead of a path segment.
 */
export function tabToViewTerm(tab: TabType): ViewTerm | null {
  switch (tab) {
    case 'profile':
      return ':profile'
    case 'comments':
      return ':comments'
    case 'capabilities':
      return ':collaborators'
    case 'children':
      return ':directory'
    default:
      return null
  }
}

/**
 * Builds the Explore route for selecting a tab on a resource. Tabs backed by a
 * view term encode it in the path (`/hm/uid/path/:comments`); explore-only tabs
 * fall back to `?tab=`. Existing query params (e.g. the `v` version) are kept.
 */
export function exploreTabHref(id: UnpackedHypermediaId, tab: TabType, searchParams: URLSearchParams): string {
  const base = `/hm/${id.uid}${hmIdPathToEntityQueryPath(id.path)}`
  const params = new URLSearchParams(searchParams)
  params.delete('tab')
  const viewTerm = tabToViewTerm(tab)
  if (viewTerm) {
    const query = params.toString()
    return `${base}/${viewTerm}${query ? `?${query}` : ''}`
  }
  params.set('tab', tab)
  return `${base}?${params.toString()}`
}

/**
 * Parses an Explore `/hm/*` route tail (the segment after `/hm/`) into its id
 * parts plus the tab implied by any trailing view term. Keeps view terms like
 * `/:profile` from leaking into the entity path, where they'd break resolution.
 */
export function parseHmRoutePath(routePath: string | undefined): {
  uid: string
  path: string[]
  viewTerm: ViewTerm | null
  defaultTab: TabType | null
  commentId?: string
} {
  const {url: cleanedPath, viewTerm, commentId} = extractViewTermFromUrl(`/${routePath ?? ''}`)
  // `/:comments/<commentId>` locates a specific comment resource. Resolve it to
  // that comment's id (uid/tsid) so the explorer opens the comment itself —
  // here :comments is the comment locator, not a tab selector.
  if (commentId) {
    const commentResourceId = commentIdToHmId(commentId)
    return {
      uid: commentResourceId.uid,
      path: commentResourceId.path?.filter(Boolean) ?? [],
      viewTerm,
      defaultTab: null,
      commentId,
    }
  }
  const parts = cleanedPath.split('/').filter(Boolean)
  return {
    uid: parts[0] ?? '',
    path: parts.slice(1),
    viewTerm,
    defaultTab: viewTermToExploreTab(viewTerm),
  }
}

/** Builds the in-app Explore route (`/hm/...`) for a hypermedia id. */
export function exploreHref(id: UnpackedHypermediaId): string {
  let href = `/hm/${id.uid}${hmIdPathToEntityQueryPath(id.path)}`
  if (id.version) {
    href += `?v=${encodeURIComponent(id.version)}`
  }
  return href
}
