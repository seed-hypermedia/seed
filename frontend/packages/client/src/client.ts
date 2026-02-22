import type {HMRequest} from '@shm/shared/hm-types'
import {HMRequestSchema} from '@shm/shared/hm-types'
import {APIParams} from '@shm/shared/api'
import {serializeQueryString} from '@shm/shared/input-querystring'
import {deserialize} from 'superjson'
import {SeedClientError, SeedNetworkError, SeedValidationError} from './errors'

export type SeedClientOptions = {
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

export type SeedClient = {
  request<Req extends HMRequest>(
    key: Req['key'],
    input: Req['input'],
  ): Promise<Req['output']>
  baseUrl: string
}

export function createSeedClient(
  baseUrl: string,
  options?: SeedClientOptions,
): SeedClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const fetchFn = options?.fetch ?? globalThis.fetch
  const defaultHeaders = options?.headers ?? {}

  return {
    baseUrl: normalizedBaseUrl,

    async request<Req extends HMRequest>(
      key: Req['key'],
      input: Req['input'],
    ): Promise<Req['output']> {
      // Find matching schema from discriminated union
      const requestSchema = HMRequestSchema.options.find(
        (schema) => schema.shape.key.value === key,
      )
      if (!requestSchema) {
        throw new SeedValidationError(`Unknown request key: ${key}`)
      }

      // Serialize input to query string (same logic as create-web-universal-client)
      const apiParams = APIParams[key as HMRequest['key']]
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
          input,
          requestSchema.shape.input as any,
        )
      }

      // Fetch
      const url = `${normalizedBaseUrl}/api/${key}${queryString}`
      let response: Response
      try {
        response = await fetchFn(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...defaultHeaders,
          },
        })
      } catch (err) {
        throw new SeedNetworkError(
          `Network error fetching ${key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          {cause: err},
        )
      }

      if (!response.ok) {
        let errorBody: string | undefined
        try {
          errorBody = await response.text()
        } catch {
          // ignore
        }
        throw new SeedClientError(
          `HTTP ${response.status} from ${key}: ${response.statusText}`,
          response.status,
          errorBody,
        )
      }

      // Deserialize superjson-wrapped response
      const rawJson = await response.json()
      const deserialized = deserialize(rawJson)

      // Validate output with zod schema
      return requestSchema.shape.output.parse(deserialized) as Req['output']
    },
  }
}
