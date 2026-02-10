import {useDraft} from '@/models/accounts'
import {useContact, useSelectedAccountContacts} from '@/models/contacts'
import {draftEditId, draftLocationId} from '@/models/drafts'
import {
  commentIdToHmId,
  getParentPaths,
  hmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {getDocumentTitle} from '@shm/shared/content'
import {useAccount, useResource, useResources} from '@shm/shared/models/entity'
import {
  ContactRoute,
  DocumentPanelRoute,
  DraftRoute,
  ProfileRoute,
} from '@shm/shared/routes'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useMemo} from 'react'
import {
  computeContactBreadcrumbs,
  computeDraftEntityParams,
  computeEntityBreadcrumbs,
  computeProfileBreadcrumbs,
  computeSimpleRouteBreadcrumbs,
  EntityContent,
  getIconForRoute,
  getWindowTitle,
  RouteBreadcrumbsResult,
} from './route-breadcrumbs'

// Re-export types and pure functions for consumers
export type {
  BreadcrumbIconKey,
  BreadcrumbItem,
  DraftEntityParams,
  EntityContent,
  RouteBreadcrumbsResult,
} from './route-breadcrumbs'
export {
  computeContactBreadcrumbs,
  computeDraftEntityParams,
  computeEntityBreadcrumbs,
  computeProfileBreadcrumbs,
  computeSimpleRouteBreadcrumbs,
  getIconForRoute,
  getWindowTitle,
} from './route-breadcrumbs'

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

const EMPTY_RESULT: RouteBreadcrumbsResult = {
  items: [],
  icon: null,
  windowTitle: null,
  isDraft: false,
  isAllError: false,
  entityId: null,
  isLatest: true,
  hideControls: false,
}

export function useRouteBreadcrumbs(): RouteBreadcrumbsResult {
  const route = useNavRoute()

  // --- Draft data (noop for non-draft routes) ---
  const isDraft = route.key === 'draft'
  const draftRoute = isDraft ? (route as DraftRoute) : undefined
  const draft = useDraft(draftRoute?.id)

  const locationId = useMemo(() => {
    if (!draftRoute) return undefined
    const lid = draftLocationId(draft.data)
    if (lid) return lid
    if (draftRoute.locationUid) {
      return hmId(draftRoute.locationUid, {path: draftRoute.locationPath})
    }
    return undefined
  }, [draftRoute, draft.data])

  const editId = useMemo(() => {
    if (!draftRoute) return undefined
    const eid = draftEditId(draft.data)
    if (eid) return eid
    if (draftRoute.editUid) {
      return hmId(draftRoute.editUid, {path: draftRoute.editPath})
    }
    return undefined
  }, [draftRoute, draft.data])

  const editDocument = useResource(editId)
  const editDocName =
    editDocument.data?.type === 'document'
      ? getDocumentTitle(editDocument.data.document)
      : undefined

  const draftParams = useMemo(() => {
    if (!draftRoute) return undefined
    return computeDraftEntityParams(
      draft.data,
      draftRoute,
      locationId,
      editId,
      editDocName,
    )
  }, [draftRoute, draft.data, locationId, editId, editDocName])

  // --- Determine entityId and panel for entity-based routes ---
  const entityId = useMemo((): UnpackedHypermediaId | undefined => {
    if (isDraft) return draftParams?.entityId
    if (
      route.key === 'document' ||
      route.key === 'feed' ||
      route.key === 'directory' ||
      route.key === 'collaborators' ||
      route.key === 'activity' ||
      route.key === 'discussions'
    ) {
      return route.id
    }
    return undefined
  }, [route, isDraft, draftParams?.entityId])

  const panel = useMemo((): DocumentPanelRoute | null | undefined => {
    if (isDraft) return draftParams?.panel
    if (route.key === 'document' || route.key === 'feed') return null
    if (route.key === 'directory')
      return {key: 'directory' as const} as DocumentPanelRoute
    if (route.key === 'collaborators')
      return {key: 'collaborators' as const} as DocumentPanelRoute
    if (route.key === 'activity')
      return {key: 'activity' as const} as DocumentPanelRoute
    if (route.key === 'discussions')
      return {
        key: 'discussions' as const,
        openComment: route.openComment,
      } as DocumentPanelRoute
    return undefined
  }, [route, isDraft, draftParams?.panel])

  // --- Entity data (noop when entityId is undefined) ---
  const contacts = useSelectedAccountContacts()
  const latestDoc = useResource(
    entityId ? {...entityId, version: null, latest: true} : null,
  )
  const isLatest =
    !entityId ||
    entityId.latest ||
    entityId.version ===
      (latestDoc.data?.type === 'document'
        ? latestDoc.data.document?.version
        : undefined)

  const isNewDraft = isDraft ? draftParams?.isNewDraft ?? false : false

  const entityIds = useMemo(() => {
    if (!entityId) return []
    const paths = getParentPaths(entityId.path)
    const subscribablePaths =
      isNewDraft && paths.length > 0 ? paths.slice(0, -1) : paths
    return subscribablePaths.map((path) => hmId(entityId.uid, {path}))
  }, [entityId, isNewDraft])

  const entityResults = useResources(entityIds, {subscribed: true})

  const entityContents: EntityContent[] = useMemo(
    () =>
      entityIds.map((id, i) => {
        const result = entityResults[i]
        const data = result?.data
        const isDiscovering = result?.isDiscovering
        if (!data) return {id, entity: undefined, isDiscovering}
        if (data.type === 'tombstone')
          return {id, entity: {id: data.id, isTombstone: true}, isDiscovering}
        if (data.type === 'not-found')
          return {id, entity: {id: data.id, isNotFound: true}, isDiscovering}
        if (data.type === 'document')
          return {
            id,
            entity: {id: data.id, document: data.document},
            isDiscovering,
          }
        return {id, entity: undefined, isDiscovering}
      }),
    [entityIds, entityResults],
  )

  // --- Comment data for discussions panel ---
  const openCommentId = useMemo(() => {
    if (panel?.key === 'discussions' && panel.openComment) {
      return commentIdToHmId(panel.openComment)
    }
    return null
  }, [panel])

  const comment = useResource(openCommentId)
  const commentData =
    comment.data?.type === 'comment' ? comment.data.comment : null
  const commentAuthorId = commentData?.author ? hmId(commentData.author) : null
  const commentAuthor = useAccount(commentAuthorId?.uid, {
    enabled: !!commentAuthorId,
  })

  // --- Contact/profile data (noop for non-matching routes) ---
  const contact = useContact(
    route.key === 'contact' ? (route as ContactRoute).id : undefined,
  )
  const profile = useAccount(
    route.key === 'profile' ? (route as ProfileRoute).id.uid : undefined,
  )

  // --- Compute result ---
  return useMemo((): RouteBreadcrumbsResult => {
    // Simple routes
    const simple = computeSimpleRouteBreadcrumbs(route.key)
    if (simple) {
      return {
        ...simple,
        isDraft: false,
        isAllError: false,
        entityId: null,
        isLatest: true,
        hideControls: false,
      }
    }

    // Contact route
    if (route.key === 'contact') {
      const name = contact.data?.metadata?.name
      return {
        items: computeContactBreadcrumbs(name),
        icon: 'contact',
        windowTitle: getWindowTitle('contact', name),
        isDraft: false,
        isAllError: false,
        entityId: null,
        isLatest: true,
        hideControls: false,
      }
    }

    // Profile route
    if (route.key === 'profile') {
      const name = profile.data?.metadata?.name
      return {
        items: computeProfileBreadcrumbs(name),
        icon: 'contact',
        windowTitle: getWindowTitle('profile', name),
        isDraft: false,
        isAllError: false,
        entityId: null,
        isLatest: true,
        hideControls: false,
      }
    }

    // Draft fallback (no locationId, no editId)
    if (isDraft && draftParams?.isFallback) {
      return {
        items: [
          {name: 'Drafts', id: null, crumbKey: 'drafts-parent'},
          {
            name: draftParams.fallbackDraftName,
            id: null,
            crumbKey: 'draft-name',
          },
        ],
        icon: 'file',
        windowTitle: getWindowTitle('draft', draftParams.fallbackDraftName),
        isDraft: true,
        isAllError: false,
        entityId: null,
        isLatest: true,
        hideControls: true,
      }
    }

    // Entity routes (document, feed, directory, collaborators, activity, discussions, draft with entity)
    if (!entityId) return EMPTY_RESULT

    const activeDocContent =
      entityContents.at(-1)?.entity?.document?.content ?? undefined

    const items = computeEntityBreadcrumbs({
      entityIds,
      entityContents,
      contacts: contacts.data,
      draftName: isDraft ? draftParams?.draftName : undefined,
      replaceLastItem: isDraft ? draftParams?.replaceLastItem : false,
      blockRef: entityId.blockRef,
      activeDocContent,
      panel: panel ?? null,
      commentAuthorName: commentAuthor.data?.metadata?.name,
      commentIsLoading: comment.isLoading,
      commentAuthorIsLoading: commentAuthor.isLoading,
    })

    const activeItem = items.at(-1)
    const isAllError = items.every((item) => item.isError)

    return {
      items,
      icon: getIconForRoute(route.key),
      windowTitle: getWindowTitle(route.key, activeItem?.name),
      isDraft,
      isAllError,
      entityId,
      isLatest,
      hideControls: isDraft ? draftParams?.hideControls ?? true : false,
    }
  }, [
    route,
    isDraft,
    draftParams,
    entityId,
    entityIds,
    entityContents,
    contacts.data,
    panel,
    comment.isLoading,
    commentAuthor.data,
    commentAuthor.isLoading,
    contact.data,
    profile.data,
    isLatest,
  ])
}
