import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {DocumentPanelRoute, DocumentRoute, NavRoute} from '../routes'
import {hmId} from './entity-id-url'

/** Parent document of `id` with no version pin, or null at the space home. */
function getParentDocumentId(id: UnpackedHypermediaId): UnpackedHypermediaId | null {
  if (!id.path?.length) return null
  return hmId(id.uid, {path: id.path.slice(0, -1), hostname: id.hostname})
}

/** A comment view steps back to the list of comments before the panel itself goes. */
function getParentPanel(panel: DocumentPanelRoute): DocumentPanelRoute | null {
  if (panel.key !== 'comments' || !panel.openComment) return null
  const {
    openComment: _openComment,
    openCommentVersion: _openCommentVersion,
    replyCommentId: _replyCommentId,
    replyCommentVersion: _replyCommentVersion,
    rootReplyCommentVersion: _rootReplyCommentVersion,
    isReplying: _isReplying,
    ...rest
  } = panel
  return rest
}

/**
 * One step up the breadcrumb / URL hierarchy from `route`, or null when there is nowhere higher
 * to go. Each press walks: a single comment → all comments → the document → its parent document →
 * … → the space home. A focused block or an open side panel is cleared first, so the keyboard walk
 * mirrors what the URL loses at each level.
 */
export function getParentRoute(route: NavRoute): NavRoute | null {
  switch (route.key) {
    case 'document': {
      if (route.panel) return {...route, panel: getParentPanel(route.panel)}
      if (route.id.blockRef) {
        return {key: 'document', id: {...route.id, blockRef: null, blockRange: null}}
      }
      const parentId = getParentDocumentId(route.id)
      return parentId ? {key: 'document', id: parentId} : null
    }
    case 'draft': {
      if (route.panel) return {...route, panel: getParentPanel(route.panel)}
      if (route.editUid) {
        const parentId = getParentDocumentId(hmId(route.editUid, {path: route.editPath ?? []}))
        return parentId ? {key: 'document', id: parentId} : null
      }
      if (route.locationUid) {
        return {key: 'document', id: hmId(route.locationUid, {path: route.locationPath ?? []})}
      }
      return null
    }
    case 'comments': {
      if (route.openComment) return {key: 'comments', id: route.id, panel: route.panel}
      return {key: 'document', id: route.id, panel: route.panel as DocumentRoute['panel']}
    }
    case 'activity':
    case 'directory':
    case 'collaborators':
    case 'metadata':
      // Each page's panel union excludes itself, so the side panel is re-widened for the document page.
      return {key: 'document', id: route.id, panel: route.panel as DocumentRoute['panel']}
    case 'feed':
    case 'site-profile':
    case 'inspect':
    case 'all-documents':
      return {key: 'document', id: route.id}
    case 'schema':
      return route.id ? {key: 'document', id: route.id} : null
    default:
      return null
  }
}
