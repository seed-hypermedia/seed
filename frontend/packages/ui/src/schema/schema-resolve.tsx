// Resolve a document's CONFORMANCE schema — the corrected model's core lookup.
//
// A schema reference (the value of an `attributesSchema` / `childAttributesSchema` metadata field,
// or an `extends` ref) is one of:
//   - an ipfs CID (`ipfs://<cid>` or bare)        -> resolve the blob directly
//   - a bundled library URL (`hm://…/<basename>`)  -> the bundled Hypermedia schema (sync)
//   - a Hypermedia document URL (`hm://acct/path`) -> fetch that document, read its
//        `schemaDefinition` metadata (the schema it DEFINES), then resolve that CID
//
// A document's EFFECTIVE attributes schema is its own metadata `attributesSchema`,
// or — when absent — its parent's `childAttributesSchema`. The resolved schema is a
// struct of attributes, which drives required-field UI.
import {useMemo} from 'react'
import {useQuery} from '@tanstack/react-query'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useUniversalClient} from '@shm/shared/routing'
import {draftBindingSchemaDrafts} from '@shm/shared/models/schema-draft'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, unpackHmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {HM_SCHEMAS, type HypermediaSchema, schemaCid} from './engine'
import {useSchemaRegistry} from './schema-registry-cid'
import {schemaDefinitionCid} from './schema-document'

export {bareCid, classifyRef, metadataSchemaOf, type RefKind} from '@seed-hypermedia/client/schema-resolve'
import {classifyRef, metadataSchemaOf} from '@seed-hypermedia/client/schema-resolve'

/**
 * Resolve a single schema reference to its Hypermedia schema. Async only for the
 * `hm-doc` and unbundled-`cid` cases (a network fetch); bundled refs resolve
 * synchronously. Advisory: an unresolvable ref simply yields `schema: undefined`.
 */
export function useResolvedSchema(ref: string | null | undefined): {
  schema?: HypermediaSchema
  /** The schema blob's CID, when known — what a conforming blob links to via its `schema` key. */
  cid?: string
  isLoading: boolean
} {
  const cls = useMemo(() => classifyRef(ref), [ref])

  // hm-doc: fetch the schema-definition document, read its `schemaDefinition`.
  const docId = useMemo(() => (cls.kind === 'hm-doc' ? unpackHmId(cls.url) : null), [cls])
  const resource = useResource(docId)
  const docSchemaCid = useMemo(() => {
    if (cls.kind !== 'hm-doc') return null
    const data = resource.data
    return data?.type === 'document' ? schemaDefinitionCid(data.document.metadata) : null
  }, [cls, resource.data])

  // The CID to fetch (direct, or the definition doc's schemaDefinition).
  const cid = cls.kind === 'cid' ? cls.cid : docSchemaCid
  const {byCid, isLoading: cidLoading} = useSchemaRegistry(cid ? [cid] : [])

  const schema = cls.kind === 'hm-bundled' ? HM_SCHEMAS[cls.name] : cid ? byCid[cid] : undefined
  const isLoading =
    !schema && ((cls.kind === 'hm-doc' && (resource.isLoading || !!docSchemaCid)) || (cls.kind === 'cid' && cidLoading))

  const schemaBlobCid = cls.kind === 'hm-bundled' ? schemaCid(cls.name) : cid ?? undefined
  return {schema, cid: schema ? schemaBlobCid : undefined, isLoading}
}

/**
 * The document's EFFECTIVE attributes schema: its own metadata `attributesSchema`,
 * else its parent's `childAttributesSchema`. Returns the resolved schema (also as
 * `metadataSchema`, for required-field UI) and which source supplied it.
 */
export function useEffectiveDocSchema(
  id: UnpackedHypermediaId | null | undefined,
  metadata: unknown,
): {
  schema?: HypermediaSchema
  metadataSchema?: HypermediaSchema
  source: 'own' | 'inherited' | 'none'
  isLoading: boolean
} {
  const ownRef =
    typeof (metadata as any)?.attributesSchema === 'string' ? ((metadata as any).attributesSchema as string) : null

  // Only look up the parent when this doc declares no `attributesSchema` of its own.
  const parentId = useMemo(() => {
    if (ownRef || !id || !id.path || id.path.length === 0) return null
    return hmId(id.uid, {path: id.path.slice(0, -1)})
  }, [ownRef, id])
  const parent = useResource(parentId)
  const parentChildrenRef = useMemo(() => {
    if (ownRef) return null
    const data = parent.data
    if (data?.type !== 'document') return null
    const cs = (data.document.metadata as any)?.childAttributesSchema
    return typeof cs === 'string' ? cs : null
  }, [ownRef, parent.data])

  const effectiveRef = ownRef ?? parentChildrenRef
  const {schema, isLoading} = useResolvedSchema(effectiveRef)
  const metadataSchema = useMemo(() => metadataSchemaOf(schema), [schema])
  const source: 'own' | 'inherited' | 'none' = ownRef ? 'own' : parentChildrenRef ? 'inherited' : 'none'

  return {schema, metadataSchema, source, isLoading: isLoading || (!!parentId && parent.isLoading)}
}

const samePath = (a: readonly string[] | null | undefined, b: readonly string[]) =>
  (a ?? []).length === b.length && b.every((segment, index) => (a ?? [])[index] === segment)

/**
 * The children attributes schema a document's PARENT is drafting but has not published — the
 * platform's own drafts, when it exposes them (desktop). While a folder's children schema is only
 * a draft, its children can still show the rows it will give them.
 */
export function useParentDraftChildAttributesSchema(id: UnpackedHypermediaId | null | undefined): {
  schema?: HypermediaSchema
  isLoading: boolean
} {
  const client = useUniversalClient()
  const parentPath = id?.path?.length ? id.path.slice(0, -1) : null
  const drafts = useQuery({
    queryKey: [queryKeys.DRAFTS_LIST_ACCOUNT, id?.uid],
    queryFn: () => client.drafts!.listAccountDrafts(id!.uid),
    enabled: !!id && !!parentPath && !!client.drafts,
  })
  const parentDraftId = useMemo(() => {
    if (!id || !parentPath) return undefined
    return drafts.data?.find((draft) => draft.editUid === id.uid && samePath(draft.editPath, parentPath))?.id
  }, [drafts.data, id, parentPath])
  const parentDraft = useQuery({
    queryKey: [queryKeys.DRAFT, parentDraftId],
    queryFn: () => client.drafts!.getDraft!(parentDraftId!),
    enabled: !!parentDraftId && !!client.drafts?.getDraft,
  })
  const drafted = draftBindingSchemaDrafts(parentDraft.data)?.childAttributesSchema ?? null
  const draftedRef = parentDraft.data?.metadata?.childAttributesSchema
  const {schema: referenced, isLoading} = useResolvedSchema(
    drafted ? null : typeof draftedRef === 'string' ? draftedRef : null,
  )
  return {schema: drafted ?? referenced, isLoading: drafts.isLoading || parentDraft.isLoading || isLoading}
}
