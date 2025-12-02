import type {HMRequest, UnpackedHypermediaId} from './hm-types'
import {HMRequestSchema} from './hm-types'
import {serializeQueryString} from './input-querystring'
import type {DeleteCommentInput, UniversalClient} from './universal-client'

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

    fetchRecents: deps.fetchRecents || (async () => []),

    deleteRecent: deps.deleteRecent || (async () => {}),

    // Not available on web - requires signing key which only desktop has
    deleteComment: async (_input: DeleteCommentInput) => {
      throw new Error('Delete comment not available on web')
    },

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
