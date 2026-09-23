// Documents typed by a schema or any of its subtypes — what a reference field with a `target`
// (`{type: hm-url, target: <animal>}`) may point at. The subtype closure is computed on the
// client from the schema pages the daemon knows (has:schemaDefinition) plus the bundled library,
// and the search is one QueryDocuments call with `attributesSchema` IN that closure. The daemon
// matches a folder-typed child through its parent's childAttributesSchema, so the picker sees
// every document the effective-schema rule types.
import {useQuery} from '@tanstack/react-query'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {schemaForCid} from '@seed-hypermedia/client/schema-engine'
import {schemaDefinitionCid} from '@seed-hypermedia/client/schema-resolve'
import {
  closeOverSubtypes,
  libraryCandidates,
  type SchemaCandidate,
  type SubtypeClosure,
} from '@seed-hypermedia/client/schema-subtypes'
import {
  AttributeValue,
  BuiltinSortAttribute,
  DocumentFilter,
  DocumentFilter_And,
  DocumentFilter_Comparison,
  DocumentFilter_Comparison_Operator,
  DocumentFilter_Or,
  DocumentFilter_Presence,
  DocumentFilter_StringMatch,
  DocumentSort,
  QueryDocumentsRequest,
} from '../client/grpc-types'
import {useUniversalClient} from '../routing'
import type {UniversalClient} from '../universal-client'
import {prepareHMDocumentInfo} from './entity'
import {queryKeys} from './query-keys'

/** How many schema pages the closure considers; a network with more types than this is not expected yet. */
const MAX_SCHEMA_PAGES = 500

const canonicalUrl = (info: HMDocumentInfo): string =>
  `hm://${info.id.uid}${info.id.path?.length ? `/${info.id.path.join('/')}` : ''}`

/** The `type` of the schema blob at `cid`: what it extends or includes, or its kind. */
async function schemaTypeAt(client: UniversalClient, cid: string): Promise<string | null> {
  const bundled = schemaForCid(cid)
  const value =
    bundled ?? ((await client.request('GetCID', {cid}).catch(() => undefined)) as {value?: unknown} | undefined)?.value
  const type = value && typeof value === 'object' ? (value as {type?: unknown}).type : undefined
  return typeof type === 'string' ? type : null
}

/** Every document that defines a schema, as candidates for the closure (each fetched once). */
async function networkCandidates(client: UniversalClient, signal?: AbortSignal): Promise<SchemaCandidate[]> {
  if (!client.queryDocuments) return []
  const pages: HMDocumentInfo[] = []
  let pageToken = ''
  while (pages.length < MAX_SCHEMA_PAGES) {
    const response = await client.queryDocuments(
      new QueryDocumentsRequest({
        filter: new DocumentFilter({
          filter: {case: 'exists', value: new DocumentFilter_Presence({key: 'schemaDefinition'})},
        }),
        pageSize: 100,
        pageToken,
      }),
      {signal},
    )
    pages.push(...response.documents.map((document) => prepareHMDocumentInfo(document)))
    if (!response.nextPageToken) break
    pageToken = response.nextPageToken
  }
  const candidates = await Promise.all(
    pages.map(async (info): Promise<SchemaCandidate | null> => {
      const cid = schemaDefinitionCid(info.metadata)
      if (!cid) return null
      // The parent is `type` when that names a schema, which the closure decides; a kind is discarded there.
      return {refs: [canonicalUrl(info), `ipfs://${cid}`], parent: await schemaTypeAt(client, cid)}
    }),
  )
  return candidates.filter((candidate): candidate is SchemaCandidate => !!candidate)
}

/**
 * The subtype closure of `target`: the target and every published or bundled schema that extends
 * it, with every spelling a document's `attributesSchema` may use for each.
 */
export function useSchemaSubtypes(target: string | null | undefined) {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.ENTITY, 'schema-subtypes', target ?? ''],
    enabled: !!target,
    staleTime: 60_000,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<SubtypeClosure> => {
      const network = await networkCandidates(client, signal).catch(() => [] as SchemaCandidate[])
      return closeOverSubtypes(target!, [...libraryCandidates(), ...network])
    },
  })
}

/** A filter matching documents whose effective attributes schema is any of `refs`. */
export function typedDocumentsFilter(refs: string[], nameText = ''): DocumentFilter {
  const typed = new DocumentFilter({
    filter: {
      case: 'or',
      value: new DocumentFilter_Or({
        filters: refs.map(
          (ref) =>
            new DocumentFilter({
              filter: {
                case: 'comparison',
                value: new DocumentFilter_Comparison({
                  key: 'attributesSchema',
                  operator: DocumentFilter_Comparison_Operator.EQUAL,
                  value: new AttributeValue({value: {case: 'stringValue', value: ref}}),
                }),
              },
            }),
        ),
      }),
    },
  })
  const needle = nameText.trim()
  if (!needle) return typed
  const byName = new DocumentFilter({
    filter: {
      case: 'stringMatch',
      value: new DocumentFilter_StringMatch({key: 'name', value: needle, caseSensitive: false, prefix: false}),
    },
  })
  return new DocumentFilter({filter: {case: 'and', value: new DocumentFilter_And({filters: [typed, byName]})}})
}

/**
 * Documents typed by `target` or a subtype of it, narrowed by name when `text` is given and the
 * most recently updated ones otherwise — the candidates for a reference field with that target.
 */
export function useTypedDocumentSearch(
  target: string | null | undefined,
  text: string,
  options: {enabled?: boolean; pageSize?: number} = {},
) {
  const client = useUniversalClient()
  const subtypes = useSchemaSubtypes(target)
  const refs = subtypes.data?.refs ?? []
  const needle = text.trim()
  const pageSize = options.pageSize ?? 8
  const results = useQuery({
    queryKey: [queryKeys.ENTITY, 'typed-documents', refs, needle, pageSize],
    enabled: (options.enabled ?? true) && refs.length > 0 && Boolean(client.queryDocuments),
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMDocumentInfo[]> => {
      if (!client.queryDocuments) return []
      const response = await client.queryDocuments(
        new QueryDocumentsRequest({
          filter: typedDocumentsFilter(refs, needle),
          sort: [new DocumentSort({attribute: BuiltinSortAttribute.UPDATE_TIME, descending: true})],
          pageSize,
        }),
        {signal},
      )
      return response.documents.map((document) => prepareHMDocumentInfo(document))
    },
  })
  return {
    data: results.data,
    closure: subtypes.data,
    isLoading: subtypes.isLoading || (refs.length > 0 && results.isLoading),
  }
}
