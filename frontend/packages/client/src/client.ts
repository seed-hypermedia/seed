import type {HMPrepareDocumentChangeInput, HMRequest, HMSigner} from '@shm/shared/hm-types'
import {HMActionSchema, HMRequestSchema} from '@shm/shared/hm-types'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {serializeQueryString} from '@shm/shared/input-querystring'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {deserialize} from 'superjson'
import {SeedClientError, SeedNetworkError, SeedValidationError} from './errors'
import {signDocumentChange} from './change'

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
  request<Req extends HMRequest>(key: Req['key'], input: Req['input']): Promise<Req['output']>
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
          body: new Uint8Array(cborEncode(validatedInput)) as unknown as BodyInit,
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
    request,
    publish,
    publishBlobs: publish,
    publishDocument,
  }
}
