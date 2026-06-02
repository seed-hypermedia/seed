import type {HMListedDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {HMListedDraftWithLocation} from '../draft-breadcrumb-context'

/**
 * Return drafts located under `parentId`, excluding drafts that edit `parentId`
 * itself. Used by query-block draft slots on every platform to list inline
 * child drafts of the query target.
 */
export function filterChildDrafts(drafts: HMListedDraft[], parentId: UnpackedHypermediaId): HMListedDraft[] {
  return drafts.filter((draft) => {
    const locationId = (draft as HMListedDraftWithLocation).locationId
    if (!locationId || locationId.id !== parentId.id) return false
    const editId = (draft as HMListedDraftWithLocation).editId
    return editId?.id !== parentId.id
  })
}
