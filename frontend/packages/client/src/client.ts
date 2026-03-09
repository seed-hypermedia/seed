import {z} from 'zod'
import type {HMPrepareDocumentChangeInput, HMRequest, HMSigner} from './hm-types'
import {HMActionSchema, HMRequestSchema, packHmId} from './hm-types'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {deserialize} from 'superjson'
import {SeedClientError, SeedNetworkError, SeedValidationError} from './errors'
import {createDocumentChange, createGenesisChange, signDocumentChange} from './change'
import {createVersionRef} from './ref'

// ─── Query string serialization ─────────────────────────────────────────────

/**
 * Reserved query param key for non-object inputs (string, number, boolean).
 */
const PRIMITIVE_VALUE_KEY = '__value'

/**
 * Serializes data to a URL query string with proper type handling.
 * Non-object inputs (string, number, boolean) are stored under a __value key.
 */
function serializeQueryString<T>(data: T, _schema?: z.ZodType<T>): string {
  const params = new URLSearchParams()

  // Handle non-object inputs (string, number, boolean)
  if (typeof data !== 'object' || data === null) {
    if (data !== undefined && data !== null) {
      params.append(PRIMITIVE_VALUE_KEY, String(data))
    }
    const queryString = params.toString()
    return queryString ? `?${queryString}` : ''
  }

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue
    }

    // Handle primitives directly
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.append(key, String(value))
    } else {
      // Handle complex objects/arrays as JSON
      params.append(key, JSON.stringify(value))
    }
  }

  const queryString = params.toString()
  return queryString ? `?${queryString}` : ''
}

/**
 * Deserializes a URL query string using a Zod schema.
 * If the query contains only a __value key, returns the primitive value directly.
 */
export function deserializeQueryString<T>(queryString: string, schema: z.ZodType<T>): T {
  // Remove leading '?' if present
  const cleanQuery = queryString.startsWith('?') ? queryString.slice(1) : queryString

  if (!cleanQuery) {
    return schema.parse({})
  }

  const params = new URLSearchParams(cleanQuery)

  // Handle primitive value inputs
  if (params.has(PRIMITIVE_VALUE_KEY) && Array.from(params.keys()).length === 1) {
    return schema.parse(params.get(PRIMITIVE_VALUE_KEY))
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Array.from(params.entries())) {
    // Try to parse as JSON first (for complex objects/arrays)
    try {
      result[key] = JSON.parse(value)
    } catch {
      // If JSON parsing fails, keep as string
      result[key] = value
    }
  }

  // Use Zod schema to parse and coerce to correct types
  return schema.parse(result)
}

export type PublishDocumentInput = {
  account: string
  changes: HMPrepareDocumentChangeInput['changes']
  path?: string
  baseVersion?: string
  genesis?: string
  generation?: number | bigint
  capability?: string
  visibility?: number
}

export type SeedClientOptions = {
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

type PublishBlobsRequest = Extract<HMRequest, {key: 'PublishBlobs'}>

const QUERY_PARAM_SERIALIZERS = {
  Account: (input: Extract<HMRequest, {key: 'Account'}>['input']) => ({
    id: input,
  }),
  Resource: (input: Extract<HMRequest, {key: 'Resource'}>['input']) => ({
    id: packHmId(input),
  }),
  ResourceMetadata: (input: Extract<HMRequest, {key: 'ResourceMetadata'}>['input']) => ({
    id: packHmId(input),
  }),
  ListCitations: (input: Extract<HMRequest, {key: 'ListCitations'}>['input']) => ({
    targetId: packHmId(input.targetId),
  }),
  ListChanges: (input: Extract<HMRequest, {key: 'ListChanges'}>['input']) => ({
    targetId: packHmId(input.targetId),
  }),
  ListCapabilities: (input: Extract<HMRequest, {key: 'ListCapabilities'}>['input']) => ({
    targetId: packHmId(input.targetId),
  }),
} as const satisfies Partial<{
  [K in HMRequest['key']]: (input: Extract<HMRequest, {key: K}>['input']) => Record<string, string>
}>

export type SeedClient = {
  request<K extends HMRequest['key']>(
    key: K,
    input: Extract<HMRequest, {key: K}>['input'],
  ): Promise<Extract<HMRequest, {key: K}>['output']>
  publish(input: PublishBlobsRequest['input']): Promise<PublishBlobsRequest['output']>
  publishBlobs(input: PublishBlobsRequest['input']): Promise<PublishBlobsRequest['output']>
  publishDocument(input: PublishDocumentInput, signer: HMSigner): Promise<void>
  baseUrl: string
}

export function createSeedClient(baseUrl: string, options?: SeedClientOptions): SeedClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const fetchFn = options?.fetch ?? globalThis.fetch
  const defaultHeaders = options?.headers ?? {}

  async function request<Req extends HMRequest>(key: Req['key'], input: Req['input']): Promise<Req['output']> {
    // Find matching schema from discriminated union
    const requestSchema = HMRequestSchema.options.find((schema) => schema.shape.key.value === key)
    if (!requestSchema) {
      throw new SeedValidationError(`Unknown request key: ${key}`)
    }

    let validatedInput: Req['input']
    try {
      validatedInput = requestSchema.shape.input.parse(input) as Req['input']
    } catch (err) {
      throw new SeedValidationError(`Invalid input for ${key}: ${err instanceof Error ? err.message : String(err)}`)
    }

    let response: Response

    const isAction = HMActionSchema.options.some((s) => s.shape.key.value === key)
    if (isAction) {
      const url = `${normalizedBaseUrl}/api/${key}`
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/cbor',
            ...defaultHeaders,
          },
          body: new Uint8Array(cborEncode(stripUndefined(validatedInput))) as unknown as BodyInit,
        })
      } catch (err) {
        throw new SeedNetworkError(
          `Network error fetching ${key}: ${err instanceof Error ? err.message : String(err)}`,
          {cause: err},
        )
      }
    } else {
      // Serialize input to query string (same logic as create-web-universal-client)
      const inputToParams = QUERY_PARAM_SERIALIZERS[key as keyof typeof QUERY_PARAM_SERIALIZERS]
      let queryString: string
      if (inputToParams) {
        const params = inputToParams(validatedInput as never)
        const searchParams = new URLSearchParams(params)
        queryString = searchParams.toString() ? `?${searchParams.toString()}` : ''
      } else if (!validatedInput) {
        queryString = ''
      } else {
        queryString = serializeQueryString(validatedInput, requestSchema.shape.input as any)
      }

      // Fetch
      const url = `${normalizedBaseUrl}/api/${key}${queryString}`
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
          `Network error fetching ${key}: ${err instanceof Error ? err.message : String(err)}`,
          {cause: err},
        )
      }
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
  }

  function publish(input: PublishBlobsRequest['input']) {
    return request<PublishBlobsRequest>('PublishBlobs', input)
  }

  async function publishDocument(input: PublishDocumentInput, signer: HMSigner): Promise<void> {
    // For new documents, create genesis + content change + ref entirely client-side
    if (!input.genesis && !input.baseVersion) {
      const genesisChange = await createGenesisChange(signer)
      const contentChange = await createDocumentChange(
        {
          changes: input.changes,
          genesisCid: genesisChange.cid,
          deps: [genesisChange.cid],
          depth: 1,
        },
        signer,
      )
      const ref = await createVersionRef(
        {
          space: input.account,
          path: input.path ?? '',
          genesis: genesisChange.cid.toString(),
          version: contentChange.cid.toString(),
          generation: input.generation != null ? Number(input.generation) : 1,
          capability: input.capability,
        },
        signer,
      )
      await publish({
        blobs: [
          {data: genesisChange.bytes, cid: genesisChange.cid.toString()},
          {data: contentChange.bytes, cid: contentChange.cid.toString()},
          ...ref.blobs,
        ],
      })
      return
    }

    // For existing documents, use PrepareDocumentChange to handle CRDT resolution
    const {unsignedChange} = (await request('PrepareDocumentChange', {
      account: input.account,
      path: input.path,
      baseVersion: input.baseVersion,
      changes: input.changes,
      capability: input.capability,
      visibility: input.visibility,
    })) as Extract<HMRequest, {key: 'PrepareDocumentChange'}>['output']
    const {publishInput} = await signDocumentChange(
      {
        account: input.account,
        path: input.path,
        unsignedChange,
        genesis: input.genesis,
        generation: input.generation,
        capability: input.capability,
      },
      signer,
    )
    await publish(publishInput)
  }

  return {
    baseUrl: normalizedBaseUrl,
    request: request as SeedClient['request'],
    publish,
    publishBlobs: publish,
    publishDocument,
  }
}

/** Remove undefined values from an object so CBOR encoding doesn't choke. */
function stripUndefined(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return obj
  if (Array.isArray(obj)) return obj.map(stripUndefined)
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) result[k] = stripUndefined(v)
  }
  return result
}
