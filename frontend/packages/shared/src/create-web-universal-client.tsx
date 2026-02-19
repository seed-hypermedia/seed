import {APIParams} from './api'
import type {HMRequest, HMSigner, UnpackedHypermediaId} from './hm-types'
import {HMRequestSchema} from './hm-types'
import {serializeQueryString} from './input-querystring'
import type {UniversalClient} from './universal-client'

// API keys that require POST with CBOR-encoded body instead of GET with query params
const CBOR_POST_KEYS = new Set<HMRequest['key']>(['PublishBlobs'])

export type WebClientDependencies = {
  // API utilities
  queryAPI: <T>(url: string) => Promise<T>

  // POST CBOR-encoded data to an API endpoint
  postCBOR?: (url: string, data: any) => Promise<any>

  // Comment editor component
  CommentEditor: (props: {docId: UnpackedHypermediaId}) => JSX.Element

  // Recents management (optional)
  fetchRecents?: () => Promise<any[]>
  deleteRecent?: (id: string) => Promise<void>

  // Platform-specific signing
  getSigner?: (accountUid: string) => HMSigner
}

export function createWebUniversalClient(deps: WebClientDependencies): UniversalClient {
  return {
    CommentEditor: deps.CommentEditor,

    fetchRecents: deps.fetchRecents,

    deleteRecent: deps.deleteRecent,

    getSigner: deps.getSigner,

    request: async <Req extends HMRequest>(key: Req['key'], input: Req['input']): Promise<Req['output']> => {
      // Find the matching request schema
      const requestSchema = HMRequestSchema.options.find((schema) => schema.shape.key.value === key)
      if (!requestSchema) {
        throw new Error(`No schema found for key: ${key}`)
      }

      // Use POST with CBOR encoding for binary endpoints
      if (CBOR_POST_KEYS.has(key as HMRequest['key'])) {
        if (!deps.postCBOR) {
          throw new Error(`postCBOR dependency required for key: ${key}`)
        }
        const url = `/api/${key}`
        const response = await deps.postCBOR(url, input)
        return requestSchema.shape.output.parse(response) as Req['output']
      }

      // Get custom params serializer if available
      const apiParams = APIParams[key as HMRequest['key']]
      // Serialize input to query string
      let queryString: string
      if (apiParams?.inputToParams) {
        const params = apiParams.inputToParams(input as any)
        const searchParams = new URLSearchParams(params)
        queryString = searchParams.toString() ? `?${searchParams.toString()}` : ''
      } else if (!input) {
        queryString = ''
      } else {
        queryString = serializeQueryString(input, requestSchema.shape.input as any)
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
