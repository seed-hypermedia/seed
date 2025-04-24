import {z} from 'zod'
import {BlockRangeSchema, unpackedHmIdSchema} from '.'

export const defaultRoute: NavRoute = {key: 'library'}

export const exploreRouteSchema = z.object({
  key: z.literal('explore'),
})
export type ExploreRoute = z.infer<typeof exploreRouteSchema>

export const contactsRouteSchema = z.object({key: z.literal('contacts')})
export type ContactsRoute = z.infer<typeof contactsRouteSchema>

export const documentVersionsAccessorySchema = z.object({
  key: z.literal('versions'),
  width: z.number().optional(),
})
export type DocumentVersionsAccessory = z.infer<
  typeof documentVersionsAccessorySchema
>

export const documentCitationsAccessorySchema = z.object({
  key: z.literal('citations'),
  width: z.number().optional(),
  openBlockId: z.string().nullable().optional(),
})
export type DocumentCitationsAccessory = z.infer<
  typeof documentCitationsAccessorySchema
>

export const documentAllDocumentsAccessorySchema = z.object({
  key: z.literal('all-documents'),
  width: z.number().optional(),
})
export type DocumentAllDocumentsAccessory = z.infer<
  typeof documentAllDocumentsAccessorySchema
>

export const documentContactsAccessorySchema = z.object({
  key: z.literal('contacts'),
  width: z.number().optional(),
})
export type DocumentContactsAccessory = z.infer<
  typeof documentContactsAccessorySchema
>

export const documentCollaboratorsAccessorySchema = z.object({
  key: z.literal('collaborators'),
  width: z.number().optional(),
})
export type DocumentCollaboratorsAccessory = z.infer<
  typeof documentCollaboratorsAccessorySchema
>

export const documentSuggestedChangesAccessorySchema = z.object({
  key: z.literal('suggested-changes'),
  width: z.number().optional(),
})
export type DocumentSuggestedChangesAccessory = z.infer<
  typeof documentSuggestedChangesAccessorySchema
>

export const documentDiscussionsAccessorySchema = z.object({
  key: z.literal('discussions'),
  width: z.number().optional(),
  openComment: z.string().optional(),
  openBlockId: z.string().optional(),
  blockRange: BlockRangeSchema.nullable().optional(),
  autoFocus: z.boolean().optional(),
})
export type DocumentDiscussionsAccessory = z.infer<
  typeof documentDiscussionsAccessorySchema
>

export const documentOptionsAccessorySchema = z.object({
  key: z.literal('options'),
  width: z.number().optional(),
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
  accessory: z
    .discriminatedUnion('key', [
      documentVersionsAccessorySchema,
      documentCitationsAccessorySchema,
      documentCollaboratorsAccessorySchema,
      documentSuggestedChangesAccessorySchema,
      documentDiscussionsAccessorySchema,
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
  id: z.string(),
  locationUid: z.string().optional(),
  locationPath: z.array(z.string()).optional(),
  editUid: z.string().optional(),
  editPath: z.array(z.string()).optional(),
  deps: z.array(z.string()).optional(),
  accessory: z
    .discriminatedUnion('key', [
      documentVersionsAccessorySchema,
      documentCitationsAccessorySchema,
      documentCollaboratorsAccessorySchema,
      documentSuggestedChangesAccessorySchema,
      documentDiscussionsAccessorySchema,
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
    | 'discussions'
    | 'citations'
    | 'contacts'
    | 'all-documents'
    | 'options'
  label: string
  icon: null | React.FC<{color: string; size?: number}>
}
