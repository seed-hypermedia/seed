import {UseQueryResult} from '@tanstack/react-query'
import type {HMDocumentInfo, HMRequest, UnpackedHypermediaId} from './hm-types'
import {HMRequestSchema} from './hm-types'
import {serializeQueryString} from './input-querystring'
import {useResource, useResources} from './models/entity'
import type {UniversalClient} from './universal-client'
import {packHmId} from './utils/entity-id-url'

export type WebClientDependencies = {
  // API utilities
  queryAPI: <T>(url: string) => Promise<T>
  useAPI: <T>(url?: string, options?: any) => UseQueryResult<T>

  // Comment editor component
  CommentEditor: (props: {docId: UnpackedHypermediaId}) => JSX.Element

  // Recents management (optional)
  fetchRecents?: () => Promise<any[]>
  deleteRecent?: (id: string) => Promise<void>
}

export type DirectoryPayload = {
  directory: HMDocumentInfo[]
}

export function createWebUniversalClient(
  deps: WebClientDependencies,
): UniversalClient {
  return {
    useResource: ((
      id: UnpackedHypermediaId | null | undefined,
      _options?: {recursive?: boolean},
    ) => {
      return useResource(id)
    }) as UniversalClient['useResource'],

    useResources: useResources,

    useDirectory: (
      id: UnpackedHypermediaId,
      options?: {mode?: string},
    ): UseQueryResult<HMDocumentInfo[]> => {
      const mode = options?.mode || 'Children'
      const url = `/hm/api/directory?id=${packHmId(id)}&mode=${mode}`
      const result = deps.useAPI<DirectoryPayload>(url)

      return {
        ...result,
        data: result.data?.directory || [],
      } as UseQueryResult<HMDocumentInfo[]>
    },

    CommentEditor: deps.CommentEditor,

    fetchRecents: deps.fetchRecents || (async () => []),

    deleteRecent: deps.deleteRecent || (async () => {}),

    request: async <Req extends HMRequest>(
      key: Req['key'],
      input: Req['input'],
    ): Promise<Req['output']> => {
      // Find the matching request schema
      const requestSchema = HMRequestSchema.options.find(
        (schema) => schema.shape.key.value === key,
      )

      if (!requestSchema) {
        throw new Error(`No schema found for key: ${key}`)
      }

      // Serialize input to query string
      const queryString = serializeQueryString(
        input as Record<string, unknown>,
        requestSchema.shape.input as any,
      )

      // Make the request to the API endpoint
      const url = `/api/${key}${queryString}`
      const response = await deps.queryAPI<Req['output']>(url)

      // Validate output with schema
      // TypeScript can't properly infer the discriminated union type from zod parse,
      // so we need to assert the type after validation
      return requestSchema.shape.output.parse(response) as Req['output']
    },
  }
}
