import {z} from 'zod'
import {
  BlockRangeSchema,
  HMResourceVisibilitySchema,
  UnpackedHypermediaId,
  unpackedHmIdSchema,
} from './hm-types'
import type {PanelQueryKey, ViewRouteKey} from './utils/entity-id-url'

export const defaultRoute: NavRoute = {key: 'library'}

export const contactsRouteSchema = z.object({key: z.literal('contacts')})
export type ContactsRoute = z.infer<typeof contactsRouteSchema>

export const contactRouteSchema = z.object({
  key: z.literal('contact'),
  id: unpackedHmIdSchema,
})
export type ContactRoute = z.infer<typeof contactRouteSchema>

export const profileRouteSchema = z.object({
  key: z.literal('profile'),
  id: unpackedHmIdSchema,
})
export type ProfileRoute = z.infer<typeof profileRouteSchema>

// Shared panel schemas for use in page-level routes
const activityPanelSchema = z.object({
  key: z.literal('activity'),
  id: unpackedHmIdSchema.optional(),
  autoFocus: z.boolean().optional(),
  filterEventType: z.array(z.string()).optional(),
})

const discussionsPanelSchema = z.object({
  key: z.literal('discussions'),
  id: unpackedHmIdSchema.optional(),
  openComment: z.string().optional(),
})

const collaboratorsPanelSchema = z.object({
  key: z.literal('collaborators'),
  id: unpackedHmIdSchema.optional(),
})

const directoryPanelSchema = z.object({
  key: z.literal('directory'),
  id: unpackedHmIdSchema.optional(),
})

// Directory page panel options
const directoryPagePanelSchema = z.discriminatedUnion('key', [
  activityPanelSchema,
  discussionsPanelSchema,
  collaboratorsPanelSchema,
])

export const directoryRouteSchema = z.object({
  key: z.literal('directory'),
  id: unpackedHmIdSchema,
  panel: directoryPagePanelSchema.nullable().optional(),
})
export type DocumentDirectorySelection = z.infer<typeof directoryRouteSchema>

// Collaborators page panel options
const collaboratorsPagePanelSchema = z.discriminatedUnion('key', [
  activityPanelSchema,
  discussionsPanelSchema,
  directoryPanelSchema,
])

export const collaboratorsRouteSchema = z.object({
  key: z.literal('collaborators'),
  id: unpackedHmIdSchema,
  panel: collaboratorsPagePanelSchema.nullable().optional(),
})
export type CollaboratorsRoute = z.infer<typeof collaboratorsRouteSchema>

// Activity page panel options
const activityPagePanelSchema = z.discriminatedUnion('key', [
  discussionsPanelSchema,
  collaboratorsPanelSchema,
  directoryPanelSchema,
])

export const documentOptionsRouteSchema = z.object({
  key: z.literal('options'),
})
export type DocumentOptionsRoute = z.infer<typeof documentOptionsRouteSchema>

export const activityRouteSchema = z.object({
  key: z.literal('activity'),
  id: unpackedHmIdSchema,
  width: z.number().optional(),
  autoFocus: z.boolean().optional(),
  filterEventType: z.array(z.string()).optional(),
  panel: activityPagePanelSchema.nullable().optional(),
})
export type ActivityRoute = z.infer<typeof activityRouteSchema>

// Discussions page panel options
const discussionsPagePanelSchema = z.discriminatedUnion('key', [
  activityPanelSchema,
  collaboratorsPanelSchema,
  directoryPanelSchema,
])

export const discussionsRouteSchema = z.object({
  key: z.literal('discussions'),
  id: unpackedHmIdSchema,
  width: z.number().optional(),
  openComment: z.string().optional(),
  targetBlockId: z.string().optional(),
  blockId: z.string().optional(),
  blockRange: BlockRangeSchema.nullable().optional(),
  autoFocus: z.boolean().optional(),
  isReplying: z.boolean().optional(),
  panel: discussionsPagePanelSchema.nullable().optional(),
})
export type DiscussionsRoute = z.infer<typeof discussionsRouteSchema>

const documentPanelRoute = z.discriminatedUnion('key', [
  activityRouteSchema,
  discussionsRouteSchema,
  directoryRouteSchema,
  collaboratorsRouteSchema,
  documentOptionsRouteSchema,
])
export type DocumentPanelRoute = z.infer<typeof documentPanelRoute>
export type PanelSelectionOptions = DocumentPanelRoute['key']

export const documentRouteSchema = z.object({
  key: z.literal('document'),
  id: unpackedHmIdSchema,
  isBlockFocused: z.boolean().optional(),
  immediatelyPromptPush: z.boolean().optional(),
  immediatelyPromptNotifs: z.boolean().optional(),
  panel: documentPanelRoute.nullable().optional(),
})

export const feedRouteSchema = z.object({
  key: z.literal('feed'),
  id: unpackedHmIdSchema,
  panel: documentPanelRoute.nullable().optional(),
})

export type DocumentRoute = z.infer<typeof documentRouteSchema>
export type FeedRoute = z.infer<typeof feedRouteSchema>

export const draftRouteSchema = z.object({
  key: z.literal('draft'),
  id: z.string(),
  locationUid: z.string().optional(),
  locationPath: z.array(z.string()).optional(),
  editUid: z.string().optional(),
  editPath: z.array(z.string()).optional(),
  deps: z.array(z.string()).optional(),
  panel: documentPanelRoute.nullable().optional(),
  isWelcomeDraft: z.boolean().optional(),
  visibility: HMResourceVisibilitySchema.optional(),
})
export type DraftRoute = z.infer<typeof draftRouteSchema>

export const previewRouteSchema = z.object({
  key: z.literal('preview'),
  draftId: z.string(),
})
export type PreviewRoute = z.infer<typeof previewRouteSchema>

export const bookmarksSchema = z.object({
  key: z.literal('bookmarks'),
})
export type BookmarksRoute = z.infer<typeof bookmarksSchema>

export const draftsSchema = z.object({
  key: z.literal('drafts'),
})
export type DraftsRoute = z.infer<typeof draftsSchema>

export const settingsRouteSchema = z.object({key: z.literal('settings')})
export type SettingsRoute = z.infer<typeof settingsRouteSchema>

export const deletedContentRouteSchema = z.object({
  key: z.literal('deleted-content'),
})

export const draftRebaseRouteSchema = z.object({
  key: z.literal('draft-rebase'),
  documentId: z.string(),
  sourceVersion: z.string(),
  targetVersion: z.string(),
})
export type DeletedContentRoute = z.infer<typeof deletedContentRouteSchema>

export const libraryRouteSchema = z.object({
  key: z.literal('library'),
  expandedIds: z.array(z.string()).optional(),
  displayMode: z.enum(['all', 'subscribed', 'bookmarks']).optional(),
  grouping: z.enum(['site', 'none']).optional(),
})
export type LibraryRoute = z.infer<typeof libraryRouteSchema>

export const navRouteSchema = z.discriminatedUnion('key', [
  libraryRouteSchema,
  contactsRouteSchema,
  profileRouteSchema,
  contactRouteSchema,
  settingsRouteSchema,
  documentRouteSchema,
  draftRouteSchema,
  draftRebaseRouteSchema,
  previewRouteSchema,
  bookmarksSchema,
  draftsSchema,
  deletedContentRouteSchema,
  feedRouteSchema,
  directoryRouteSchema,
  collaboratorsRouteSchema,
  activityRouteSchema,
  discussionsRouteSchema,
])
export type NavRoute = z.infer<typeof navRouteSchema>

export function getRecentsRouteEntityUrl(route: NavRoute) {
  // this is used to uniquely identify an item for the recents list. So it references the entity without specifying version
  if (route.key === 'document') return route.id.id
  // comments do not show up in the recents list, we do not know how to display them
  return null
}

export type DocSelectionOption = {
  key: PanelSelectionOptions
  label: string
}

export function getRoutePanel(route: NavRoute): NavRoute | null {
  let panel: DocumentPanelRoute | undefined | null = undefined
  let routeId: z.infer<typeof unpackedHmIdSchema> | undefined = undefined
  if (route.key === 'document') {
    panel = route.panel
    routeId = route.id
  } else if (route.key === 'draft') {
    panel = route.panel
  } else if (route.key === 'feed') {
    panel = route.panel
    routeId = route.id
  } else if (route.key === 'directory') {
    panel = route.panel as DocumentPanelRoute | null
    routeId = route.id
  } else if (route.key === 'collaborators') {
    panel = route.panel as DocumentPanelRoute | null
    routeId = route.id
  } else if (route.key === 'activity') {
    panel = route.panel as DocumentPanelRoute | null
    routeId = route.id
  } else if (route.key === 'discussions') {
    panel = route.panel as DocumentPanelRoute | null
    routeId = route.id
  }
  if (panel?.key === 'options') return null
  if (!panel) return null
  // Ensure panel has id from parent route if not set
  if (routeId && 'id' in panel && !panel.id) {
    return {...panel, id: routeId} as NavRoute
  }
  return panel as NavRoute
}

export function routeToPanelRoute(route: NavRoute): DocumentPanelRoute | null {
  switch (route.key) {
    case 'activity': {
      const {panel, ...rest} = route
      return rest
    }
    case 'discussions': {
      const {panel, ...rest} = route
      return rest
    }
    case 'directory': {
      const {panel, ...rest} = route
      return rest
    }
    case 'collaborators': {
      const {panel, ...rest} = route
      return rest
    }
    default:
      return null
  }
}

/**
 * Create a DocumentPanelRoute from a panel key
 */
function createPanelRoute(
  panelParam: PanelQueryKey,
  docId: UnpackedHypermediaId,
): DocumentPanelRoute {
  switch (panelParam) {
    case 'activity':
      return {key: 'activity', id: docId}
    case 'discussions':
      return {key: 'discussions', id: docId}
    case 'directory':
      return {key: 'directory', id: docId}
    case 'collaborators':
      return {key: 'collaborators', id: docId}
    case 'options':
      return {key: 'options'}
  }
}

/**
 * Convert docId + viewTerm + panelParam into a NavRoute
 * Used by web to initialize navigation context from URL
 */
export function createDocumentNavRoute(
  docId: UnpackedHypermediaId,
  viewTerm?: ViewRouteKey | null,
  panelParam?: PanelQueryKey | null,
): NavRoute {
  // Create properly typed panel route if panelParam provided
  const panel = panelParam ? createPanelRoute(panelParam, docId) : null

  switch (viewTerm) {
    case 'activity':
      return {key: 'activity', id: docId}
    case 'discussions':
      return {key: 'discussions', id: docId}
    case 'directory':
      return {key: 'directory', id: docId}
    case 'collaborators':
      return {key: 'collaborators', id: docId}
    default:
      return {key: 'document', id: docId, panel}
  }
}
