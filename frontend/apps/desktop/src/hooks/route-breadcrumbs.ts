import {HMContactRecord, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {findContentBlock, getBlockText, getContactMetadata, getDocumentTitle, hmId} from '@shm/shared'
import type {NavRoute} from '@shm/shared/routes'
import {activityFilterToSlug} from '@shm/shared/utils/entity-id-url'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BreadcrumbIconKey = 'contact' | 'star' | 'file' | null

export type BreadcrumbItem = {
  name?: string
  fallbackName?: string
  id: UnpackedHypermediaId | null
  isError?: boolean
  isLoading?: boolean
  isTombstone?: boolean
  isNotFound?: boolean
  crumbKey: string
}

export type RouteBreadcrumbsResult = {
  items: BreadcrumbItem[]
  icon: BreadcrumbIconKey
  windowTitle: string | null
  isDraft: boolean
  isAllError: boolean
  entityId: UnpackedHypermediaId | null
  isLatest: boolean
  hideControls: boolean
}

export type EntityContent = {
  id: UnpackedHypermediaId
  entity:
    | {
        id: any
        document?: any
        isTombstone?: boolean
        isNotFound?: boolean
      }
    | undefined
  isDiscovering?: boolean
}

export type DraftEntityParams = {
  entityId: UnpackedHypermediaId | undefined
  panel: any
  draftName: string | undefined
  replaceLastItem: boolean
  isNewDraft: boolean
  hideControls: boolean
  isFallback: boolean
  fallbackDraftName: string
}

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

export function getIconForRoute(routeKey: string): BreadcrumbIconKey {
  switch (routeKey) {
    case 'contacts':
    case 'contact':
    case 'profile':
      return 'contact'
    case 'bookmarks':
      return 'star'
    case 'draft':
      return 'file'
    default:
      return null
  }
}

const STATIC_WINDOW_TITLES: Partial<Record<NavRoute['key'], string>> = {
  onboarding: 'Welcome to Seed Hypermedia',
  library: 'Library',
  contacts: 'Contacts',
  bookmarks: 'Bookmarks',
  drafts: 'Drafts',
  settings: 'Settings',
  'account-settings': 'Identity Settings',
  'space-settings': 'Space Settings',
  'deleted-content': 'Deleted Content',
  'api-inspector': 'API Inspector',
  'query-documents': 'Query Documents',
  explore: 'Explore',
  agents: 'Agents',
  'agent-server': 'Agents',
  agent: 'Agent',
  'agent-session': 'Agent Session',
  notifications: 'Notifications',
  'space-settings-emails': 'Email Settings',
  'inspect-ipfs': 'IPFS Inspector',
}

/** Returns the native window title for the active navigation route. */
export function getWindowTitle(route: NavRoute, activeName?: string): string {
  const staticTitle = STATIC_WINDOW_TITLES[route.key]
  if (staticTitle) return staticTitle
  if (!activeName) return 'Seed'

  switch (route.key) {
    case 'activity':
      return `${activeName} – ${activityFilterToSlug(route.filterEventType) === 'citations' ? 'Citations' : 'Activity'}`
    case 'comments':
      return `${activeName} – Discussions`
    case 'directory':
    case 'all-documents':
      return `${activeName} – Sub-documents`
    case 'collaborators':
      return `${activeName} – Collaborators`
    case 'metadata':
      return `${activeName} – Metadata`
    case 'inspect':
      return `${activeName} – Inspector`
    case 'feed':
      return `${activeName} – Feed`
    default:
      return activeName
  }
}

export function computeSimpleRouteBreadcrumbs(routeKey: string): {
  items: BreadcrumbItem[]
  icon: BreadcrumbIconKey
  windowTitle: string | null
} | null {
  switch (routeKey) {
    case 'contacts':
      return {
        items: [{name: 'Contacts', id: null, crumbKey: 'contacts'}],
        icon: 'contact',
        windowTitle: 'Contacts',
      }
    case 'bookmarks':
      return {
        items: [{name: 'Bookmarks', id: null, crumbKey: 'bookmarks'}],
        icon: 'star',
        windowTitle: 'Bookmarks',
      }
    case 'api-inspector':
      return {
        items: [{name: 'API Inspector', id: null, crumbKey: 'api-inspector'}],
        icon: null,
        windowTitle: 'API Inspector',
      }
    default:
      return null
  }
}

export function computeContactBreadcrumbs(name?: string): BreadcrumbItem[] {
  return [
    {name: 'Contacts', id: null, crumbKey: 'contacts-parent'},
    {
      name: name || 'Untitled Contact',
      id: null,
      crumbKey: 'contact',
    },
  ]
}

export function computeProfileBreadcrumbs(name?: string): BreadcrumbItem[] {
  return [
    {name: 'Profile', id: null, crumbKey: 'profile-parent'},
    {
      name: name || 'Untitled Profile',
      id: null,
      crumbKey: 'profile',
    },
  ]
}

export function computeEntityBreadcrumbs(params: {
  entityIds: UnpackedHypermediaId[]
  entityContents: EntityContent[]
  contacts: HMContactRecord[] | null | undefined
  draftName?: string
  replaceLastItem?: boolean
  blockRef?: string | null
  activeDocContent?: any
  panel?: {key: string; openComment?: string} | null
  commentAuthorName?: string
  commentIsLoading?: boolean
  commentAuthorIsLoading?: boolean
}): BreadcrumbItem[] {
  const {
    entityIds,
    entityContents,
    contacts,
    draftName,
    replaceLastItem,
    blockRef,
    activeDocContent,
    panel,
    commentAuthorName,
    commentIsLoading,
    commentAuthorIsLoading,
  } = params

  const crumbs: BreadcrumbItem[] = []

  const items = entityIds.flatMap((id, idIndex) => {
    const contents = entityContents[idIndex]
    let name: string
    if (id.path?.length) {
      name = getDocumentTitle(contents?.entity?.document) || ''
    } else {
      name = getContactMetadata(id.uid, contents?.entity?.document?.metadata, contacts ?? undefined).name
    }
    const isNotFound = contents?.entity?.isNotFound || false
    const isTombstone = contents?.entity?.isTombstone || false
    const isLoading = !!contents?.isDiscovering
    return [
      {
        name,
        fallbackName: id.path?.at(-1) || id.uid.slice(0, 8),
        isError: contents?.entity && !contents.entity.document && !isTombstone && !isNotFound,
        isTombstone,
        isNotFound,
        isLoading,
        id,
        crumbKey: `id-${idIndex}`,
      },
    ]
  })

  crumbs.push(...items)

  if (draftName && replaceLastItem) {
    crumbs.pop()
  }

  if (draftName) {
    crumbs.push({
      name: draftName,
      fallbackName: draftName,
      id: null,
      crumbKey: `draft-${draftName}`,
    })
  }

  if (!panel?.key && blockRef) {
    const blockNode = activeDocContent ? findContentBlock(activeDocContent, blockRef) : null
    const blockText = (blockNode?.block && getBlockText(blockNode?.block)) || 'Block'
    const truncatedBlockText = blockText.length > 50 ? blockText.slice(0, 50) + '...' : blockText
    crumbs.push({
      name: truncatedBlockText,
      id: null,
      crumbKey: 'content',
    })
  }

  if (panel?.key === 'collaborators') {
    crumbs.push({name: 'Collaborators', id: null, crumbKey: 'collaborators'})
  }
  if (panel?.key === 'comments') {
    if (panel.openComment) {
      crumbs.push({
        name: commentAuthorName ? `Comment by ${commentAuthorName}` : 'Comment',
        isLoading: commentIsLoading || commentAuthorIsLoading,
        id: null,
        crumbKey: 'comment',
      })
    } else {
      crumbs.push({name: 'Discussions', id: null, crumbKey: 'comments'})
    }
  }
  if (panel?.key === 'directory') {
    crumbs.push({name: 'Sub documents', id: null, crumbKey: 'directory'})
  }
  if (panel?.key === 'activity') {
    crumbs.push({name: 'Activity', id: null, crumbKey: 'activity'})
  }
  if (panel?.key === 'inspect') {
    crumbs.push({name: 'Inspector', id: null, crumbKey: 'inspect'})
  }

  return crumbs
}

export function computeDraftEntityParams(
  draftData: any,
  route: {
    visibility?: string
    panel?: any
    locationUid?: string
    locationPath?: string[]
    editUid?: string
    editPath?: string[]
  },
  locationId: UnpackedHypermediaId | undefined,
  editId: UnpackedHypermediaId | undefined,
  editDocName: string | undefined,
): DraftEntityParams {
  const isPrivate = route.visibility === 'PRIVATE' || draftData?.visibility === 'PRIVATE'
  const displayName = draftData?.metadata?.name || editDocName

  if (locationId) {
    return {
      entityId: isPrivate ? hmId(locationId.uid) : locationId,
      panel: route.panel,
      draftName: draftData?.metadata?.name || 'New Draft',
      replaceLastItem: false,
      isNewDraft: false,
      hideControls: true,
      isFallback: false,
      fallbackDraftName: draftData?.metadata?.name || 'New Draft',
    }
  }

  if (editId) {
    return {
      entityId: editId,
      panel: route.panel,
      draftName: displayName,
      replaceLastItem: !!displayName,
      isNewDraft: !draftData?.deps?.length,
      hideControls: true,
      isFallback: false,
      fallbackDraftName: draftData?.metadata?.name || 'New Draft',
    }
  }

  return {
    entityId: undefined,
    panel: null,
    draftName: undefined,
    replaceLastItem: false,
    isNewDraft: false,
    hideControls: true,
    isFallback: true,
    fallbackDraftName: draftData?.metadata?.name || 'New Draft',
  }
}
