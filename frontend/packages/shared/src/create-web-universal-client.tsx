import {APIParams} from './api'
import type {HMRequest, UnpackedHypermediaId} from './hm-types'
import {HMRequestSchema} from './hm-types'
import {serializeQueryString} from './input-querystring'
import type {UniversalClient} from './universal-client'

export type WebClientDependencies = {
  // API utilities
  queryAPI: <T>(url: string) => Promise<T>

  // Comment editor component
  CommentEditor: (props: {docId: UnpackedHypermediaId}) => JSX.Element

  // Recents management (optional)
  fetchRecents?: () => Promise<any[]>
  deleteRecent?: (id: string) => Promise<void>
}

export function createWebUniversalClient(
  deps: WebClientDependencies,
): UniversalClient {
  return {
    CommentEditor: deps.CommentEditor,

    fetchRecents: deps.fetchRecents,

    deleteRecent: deps.deleteRecent,

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
      // Get custom params serializer if available
      const apiParams = APIParams[key as HMRequest['key']]
      // Serialize input to query string
      let queryString: string
      if (apiParams?.inputToParams) {
        const params = apiParams.inputToParams(input as any)
        const searchParams = new URLSearchParams(params)
        queryString = searchParams.toString()
          ? `?${searchParams.toString()}`
          : ''
      } else if (!input) {
        queryString = ''
      } else {
        queryString = serializeQueryString(
          input as Record<string, unknown>,
          requestSchema.shape.input as any,
        )
      }
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
