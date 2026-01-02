import {z} from 'zod'
import {BlockRangeSchema, unpackedHmIdSchema} from './hm-types'

export const defaultRoute: NavRoute = {key: 'library'}

export const exploreRouteSchema = z.object({
  key: z.literal('explore'),
})
export type ExploreRoute = z.infer<typeof exploreRouteSchema>

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

export const documentDirectoryAccessorySchema = z.object({
  key: z.literal('directory'),
})
export type DocumentDirectoryAccessory = z.infer<
  typeof documentDirectoryAccessorySchema
>

export const documentContactsAccessorySchema = z.object({
  key: z.literal('contacts'),
})
export type DocumentContactsAccessory = z.infer<
  typeof documentContactsAccessorySchema
>

export const documentCollaboratorsAccessorySchema = z.object({
  key: z.literal('collaborators'),
})
export type DocumentCollaboratorsAccessory = z.infer<
  typeof documentCollaboratorsAccessorySchema
>

export const documentSuggestedChangesAccessorySchema = z.object({
  key: z.literal('suggested-changes'),
})
export type DocumentSuggestedChangesAccessory = z.infer<
  typeof documentSuggestedChangesAccessorySchema
>

export const documentOptionsAccessorySchema = z.object({
  key: z.literal('options'),
})
export type DocumentOptionsAccessory = z.infer<
  typeof documentOptionsAccessorySchema
>

export const documentActivityAccessorySchema = z.object({
  key: z.literal('activity'),
  width: z.number().optional(),
  autoFocus: z.boolean().optional(),
  filterEventType: z.array(z.string()).optional(),
})
export type DocumentActivityAccessory = z.infer<
  typeof documentActivityAccessorySchema
>

export const documentDiscussionsAccessorySchema = z.object({
  key: z.literal('discussions'),
  width: z.number().optional(),
  openComment: z.string().optional(),
  targetBlockId: z.string().optional(),
  blockId: z.string().optional(),
  blockRange: BlockRangeSchema.nullable().optional(),
  autoFocus: z.boolean().optional(),
  isReplying: z.boolean().optional(),
})
export type DocumentDiscussionsAccessory = z.infer<
  typeof documentDiscussionsAccessorySchema
>

const documentAccessorySchema = z.discriminatedUnion('key', [
  documentActivityAccessorySchema,
  documentDiscussionsAccessorySchema,
  documentDirectoryAccessorySchema,
  documentCollaboratorsAccessorySchema,
  documentContactsAccessorySchema,
  documentOptionsAccessorySchema,
])
export type DocumentAccessory = z.infer<typeof documentAccessorySchema>
export type AccessoryOptions = DocumentAccessory['key']

export const documentRouteSchema = z.object({
  key: z.literal('document'),
  id: unpackedHmIdSchema,
  isBlockFocused: z.boolean().optional(),
  immediatelyPromptPush: z.boolean().optional(),
  immediatelyPromptNotifs: z.boolean().optional(),
  accessory: documentAccessorySchema.nullable().optional(),
})

export const feedRouteSchema = z.object({
  key: z.literal('feed'),
  id: unpackedHmIdSchema,
  accessory: documentAccessorySchema.nullable().optional(),
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
  accessory: documentAccessorySchema.nullable().optional(),
  isWelcomeDraft: z.boolean().optional(),
})
export type DraftRoute = z.infer<typeof draftRouteSchema>

export const previewRouteSchema = z.object({
  key: z.literal('preview'),
  draftId: z.string(),
})
export type PreviewRoute = z.infer<typeof previewRouteSchema>

export const favoritesSchema = z.object({
  key: z.literal('favorites'),
})
export type FavoritesRoute = z.infer<typeof favoritesSchema>

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
  displayMode: z.enum(['all', 'subscribed', 'favorites']).optional(),
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
  exploreRouteSchema,
  favoritesSchema,
  draftsSchema,
  deletedContentRouteSchema,
  feedRouteSchema,
])
export type NavRoute = z.infer<typeof navRouteSchema>

export function getRecentsRouteEntityUrl(route: NavRoute) {
  // this is used to uniquely identify an item for the recents list. So it references the entity without specifying version
  if (route.key === 'document') return route.id.id
  // comments do not show up in the recents list, we do not know how to display them
  return null
}

export type DocAccessoryOption = {
  key: AccessoryOptions
  label: string
}
