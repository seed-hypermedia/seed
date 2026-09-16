// Schema pages — documents that DEFINE a schema (carry `schemaDefinition`) — found through the
// attribute query, so a picker for a document's attributes schema offers only pages whose URL
// will resolve to a schema. Text narrows by name; none lists the most recently updated pages.
import {useQuery} from '@tanstack/react-query'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {
  BuiltinSortAttribute,
  DocumentFilter,
  DocumentFilter_And,
  DocumentFilter_Presence,
  DocumentFilter_StringMatch,
  DocumentSort,
  QueryDocumentsRequest,
} from '../client/grpc-types'
import {queryKeys} from './query-keys'
import {useUniversalClient} from '../routing'
import {prepareHMDocumentInfo} from './entity'

export function useSchemaDocumentSearch(text: string, options: {enabled?: boolean; pageSize?: number} = {}) {
  const client = useUniversalClient()
  const needle = text.trim()
  const pageSize = options.pageSize ?? 8
  return useQuery({
    queryKey: [queryKeys.ENTITY, 'schema-documents', needle, pageSize],
    enabled: (options.enabled ?? true) && Boolean(client.queryDocuments),
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMDocumentInfo[]> => {
      if (!client.queryDocuments) return []
      const filters = [
        new DocumentFilter({filter: {case: 'exists', value: new DocumentFilter_Presence({key: 'schemaDefinition'})}}),
        ...(needle
          ? [
              new DocumentFilter({
                filter: {
                  case: 'stringMatch',
                  value: new DocumentFilter_StringMatch({
                    key: 'name',
                    value: needle,
                    caseSensitive: false,
                    prefix: false,
                  }),
                },
              }),
            ]
          : []),
      ]
      const response = await client.queryDocuments(
        new QueryDocumentsRequest({
          filter:
            filters.length === 1
              ? filters[0]
              : new DocumentFilter({filter: {case: 'and', value: new DocumentFilter_And({filters})}}),
          sort: [new DocumentSort({attribute: BuiltinSortAttribute.UPDATE_TIME, descending: true})],
          pageSize,
        }),
        {signal},
      )
      return response.documents.map((document) => prepareHMDocumentInfo(document))
    },
  })
}
