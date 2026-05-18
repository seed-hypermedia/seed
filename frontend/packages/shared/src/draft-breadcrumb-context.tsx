import type {HMListedDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, useContext} from 'react'
import {pathMatches} from './utils/entity-id-url'

/**
 * `HMListedDraft` plus the resolved `locationId` / `editId` that the desktop
 * draft endpoints (see `app-drafts.ts`) compute from the raw uid + path
 * fields. Lifted into shared so providers on every platform can return the
 * same shape.
 */
export type HMListedDraftWithLocation = HMListedDraft & {
  locationId?: UnpackedHypermediaId
  editId?: UnpackedHypermediaId
}

/**
 * Cross-platform draft data lookup needed by the document-header breadcrumb.
 * Desktop and web each ship a provider; environments without a provider
 * (SSR, tests) read through {@link useDraftsForAccountSafe} and behave as if
 * there are no drafts.
 */
export type DraftBreadcrumbContextValue = {
  useDraftsForAccount: (uid: string | undefined) => {
    data: HMListedDraftWithLocation[] | undefined
    isLoading: boolean
  }
}

export const DraftBreadcrumbContext = createContext<DraftBreadcrumbContextValue | null>(null)

const EMPTY_RESULT = {data: [] as HMListedDraftWithLocation[], isLoading: false}

/**
 * Read the draft list for an account through the context, falling back to an
 * empty result when no provider is mounted. Call from React render only —
 * the underlying hook is invoked each call.
 */
export function useDraftsForAccountSafe(uid: string | undefined): {
  data: HMListedDraftWithLocation[] | undefined
  isLoading: boolean
} {
  const ctx = useContext(DraftBreadcrumbContext)
  if (!ctx) return EMPTY_RESULT
  return ctx.useDraftsForAccount(uid)
}

/**
 * Find the draft that targets the given path under the given account.
 *
 * Two match strategies, in order:
 * 1. Exact `editId` match — draft is editing the published doc at that path
 *    (covers renamed-but-unpublished titles overriding the published doc).
 * 2. `locationId` parent match when the requested path ends with a
 *    `-${draftId}` placeholder segment — covers new-child drafts that don't
 *    yet have a published path. We match `locationId` against
 *    `path.slice(0, -1)` since `editPath = [...locationPath, '-draftId']`.
 *
 * Returns `null` when nothing matches.
 */
export function findDraftForPath(
  drafts: HMListedDraftWithLocation[] | undefined,
  uid: string,
  path: string[] | undefined,
): HMListedDraftWithLocation | null {
  if (!drafts || drafts.length === 0) return null
  const normalizedPath = path ?? []

  for (const draft of drafts) {
    if (draft.editId && draft.editId.uid === uid && pathMatches(draft.editId.path, normalizedPath)) {
      return draft
    }
  }

  const lastSegment = normalizedPath[normalizedPath.length - 1]
  if (lastSegment && lastSegment.startsWith('-')) {
    const parentPath = normalizedPath.slice(0, -1)
    for (const draft of drafts) {
      if (draft.locationId && draft.locationId.uid === uid && pathMatches(draft.locationId.path, parentPath)) {
        return draft
      }
    }
  }

  return null
}
