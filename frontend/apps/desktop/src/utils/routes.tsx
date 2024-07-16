import {unpackedHmIdSchema} from '@shm/shared'
import {z} from 'zod'

export const defaultRoute: NavRoute = {key: 'library'}

export const feedRouteSchema = z.object({
  key: z.literal('feed'),
})
export type FeedRoute = z.infer<typeof feedRouteSchema>

export const exploreRouteSchema = z.object({
  key: z.literal('explore'),
})
export type ExploreRoute = z.infer<typeof exploreRouteSchema>

export const contactsRouteSchema = z.object({key: z.literal('contacts')})
export type ContactsRoute = z.infer<typeof contactsRouteSchema>

export const documentVersionsAccessorySchema = z.object({
  key: z.literal('versions'),
})
export type DocumentVersionsAccessory = z.infer<
  typeof documentVersionsAccessorySchema
>

export const documentCitationsAccessorySchema = z.object({
  key: z.literal('citations'),
})
export type DocumentCitationsAccessory = z.infer<
  typeof documentCitationsAccessorySchema
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

export const documentCommentsAccessorySchema = z.object({
  key: z.literal('comments'),
})
export type DocumentCommentsAccessory = z.infer<
  typeof documentCommentsAccessorySchema
>

export const documentRouteSchema = z.object({
  key: z.literal('document'),
  id: unpackedHmIdSchema,
  isBlockFocused: z.boolean().optional(),
  immediatelyPromptPush: z.boolean().optional(),
  tab: z.enum(['home', 'documents', 'activity', 'contacts']).optional(), // home is the default
  accessory: z
    .discriminatedUnion('key', [
      documentVersionsAccessorySchema,
      documentCitationsAccessorySchema,
      documentCollaboratorsAccessorySchema,
      documentSuggestedChangesAccessorySchema,
      documentCommentsAccessorySchema,
    ])
    .nullable()
    .optional(),
})
export type DocumentRoute = z.infer<typeof documentRouteSchema>

export const draftRouteSchema = z.object({
  key: z.literal('draft'),
  id: z.string().optional(),
  deps: z.array(z.string()).optional(),
})
export type DraftRoute = z.infer<typeof draftRouteSchema>

export const favoritesSchema = z.object({
  key: z.literal('favorites'),
})
export type FavoritesRoute = z.infer<typeof favoritesSchema>

export const commentRouteSchema = z.object({
  key: z.literal('comment'),
  commentId: z.string().optional(),
  showThread: z.boolean().optional(),
})
export type CommentRoute = z.infer<typeof commentRouteSchema>

export const commentDraftRouteSchema = z.object({
  key: z.literal('comment-draft'),
  commentId: z.string().optional(),
  showThread: z.boolean().optional(),
})
export type CommentDraftRoute = z.infer<typeof commentDraftRouteSchema>

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
})
export type LibraryRoute = z.infer<typeof libraryRouteSchema>

export const navRouteSchema = z.discriminatedUnion('key', [
  feedRouteSchema,
  libraryRouteSchema,
  contactsRouteSchema,
  settingsRouteSchema,
  documentRouteSchema,
  draftRouteSchema,
  draftRebaseRouteSchema,
  commentRouteSchema,
  commentDraftRouteSchema,
  exploreRouteSchema,
  favoritesSchema,
  deletedContentRouteSchema,
])
export type NavRoute = z.infer<typeof navRouteSchema>

export function getRecentsRouteEntityUrl(route: NavRoute) {
  // this is used to uniquely identify an item for the recents list. So it references the entity without specifying version
  if (route.key === 'document') return route.id.qid
  // comments do not show up in the recents list, we do not know how to display them
  return null
}
