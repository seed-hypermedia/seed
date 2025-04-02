import {z} from 'zod'
import {unpackedHmIdSchema} from '.'

export const defaultRoute: NavRoute = {key: 'library'}

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

export const documentAllDocumentsAccessorySchema = z.object({
  key: z.literal('all-documents'),
})
export type DocumentAllDocumentsAccessory = z.infer<
  typeof documentAllDocumentsAccessorySchema
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

export const documentCommentsAccessorySchema = z.object({
  key: z.literal('comments'),
})
export type DocumentCommentsAccessory = z.infer<
  typeof documentCommentsAccessorySchema
>

export const documentOptionsAccessorySchema = z.object({
  key: z.literal('options'),
})
export type DocumentOptionsAccessory = z.infer<
  typeof documentOptionsAccessorySchema
>

export const documentRouteSchema = z.object({
  key: z.literal('document'),
  id: unpackedHmIdSchema,
  isBlockFocused: z.boolean().optional(),
  immediatelyPromptPush: z.boolean().optional(),
  immediatelyPromptTemplate: z.boolean().optional(),
  tab: z.enum(['directory', 'discussion']).optional(), // directory is the default
  accessory: z
    .discriminatedUnion('key', [
      documentVersionsAccessorySchema,
      documentCitationsAccessorySchema,
      documentCollaboratorsAccessorySchema,
      documentSuggestedChangesAccessorySchema,
      documentCommentsAccessorySchema,
      documentAllDocumentsAccessorySchema,
      documentContactsAccessorySchema,
      documentOptionsAccessorySchema,
    ])
    .nullable()
    .optional(),
})
export type DocumentRoute = z.infer<typeof documentRouteSchema>

export const draftRouteSchema = z.object({
  key: z.literal('draft'),
  id: z.string().optional(),
  locationUid: z.string().optional(),
  locationPath: z.string().array().optional(),
  editUid: z.string().optional(),
  editPath: z.string().array().optional(),
  deps: z.array(z.string().min(1)).optional().default([]),
  accessory: z
    .discriminatedUnion('key', [
      documentVersionsAccessorySchema,
      documentCitationsAccessorySchema,
      documentCollaboratorsAccessorySchema,
      documentSuggestedChangesAccessorySchema,
      documentCommentsAccessorySchema,
      documentAllDocumentsAccessorySchema,
      documentContactsAccessorySchema,
      documentOptionsAccessorySchema,
    ])
    .nullable()
    .optional(),
})
export type DraftRoute = z.infer<typeof draftRouteSchema>

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
  settingsRouteSchema,
  documentRouteSchema,
  draftRouteSchema,
  draftRebaseRouteSchema,
  exploreRouteSchema,
  favoritesSchema,
  draftsSchema,
  deletedContentRouteSchema,
])
export type NavRoute = z.infer<typeof navRouteSchema>

export function getRecentsRouteEntityUrl(route: NavRoute) {
  // this is used to uniquely identify an item for the recents list. So it references the entity without specifying version
  if (route.key === 'document') return route.id.id
  // comments do not show up in the recents list, we do not know how to display them
  return null
}

export type DocAccessoryOption = {
  key:
    | 'versions'
    | 'collaborators'
    | 'suggested-changes'
    | 'comments'
    | 'citations'
    | 'contacts'
    | 'all-documents'
    | 'options'
  label: string
  icon: null | React.FC<{color: string; size?: number}>
}
