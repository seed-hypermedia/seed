import {serialize} from 'superjson'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {HMActionSchema, HMGetRequestSchema} from './hm-types'
import {APIParams, APIQueries, APIActions} from './api'
import {deserializeQueryString} from './input-querystring'
import type {GRPCClient} from './grpc-client'
import type {QueryDaemonFn} from './api-types'

export type ApiResponse = {
  status: number
  body: string
  headers: Record<string, string>
}

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Handle GET requests: input deserialized from query string */
export async function handleApiRequest(
  url: URL,
  grpcClient: GRPCClient,
  queryDaemon: QueryDaemonFn,
): Promise<ApiResponse> {
  const pathParts = url.pathname.replace(/^\/api\//, '').split('/')
  const key = pathParts[0]

  if (!key) {
    return {status: 400, body: JSON.stringify({error: 'Missing API key'}), headers: CORS_HEADERS}
  }

  const apiDefinition = APIQueries[key as keyof typeof APIQueries]
  if (!apiDefinition) {
    return {status: 404, body: JSON.stringify({error: `Unknown query key: ${key}`}), headers: CORS_HEADERS}
  }

  const requestSchema = HMGetRequestSchema.options.find((schema) => schema.shape.key.value === key)
  if (!requestSchema) {
    return {status: 500, body: JSON.stringify({error: `No schema found for key: ${key}`}), headers: CORS_HEADERS}
  }

  try {
    const apiParams = APIParams[key as keyof typeof APIParams]
    let input: any
    if (apiParams?.paramsToInput) {
      const params: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        params[key] = value
      })
      input = apiParams.paramsToInput(params)
    } else {
      input = deserializeQueryString(url.search, requestSchema.shape.input as any)
    }

    const output = await apiDefinition.getData(grpcClient, input as any, queryDaemon)
    const validatedOutput = requestSchema.shape.output.parse(output)
    return {status: 200, body: JSON.stringify(serialize(validatedOutput)), headers: CORS_HEADERS}
  } catch (error) {
    console.error('API error:', error)
    return {
      status: 500,
      body: JSON.stringify({error: error instanceof Error ? error.message : 'Unknown error'}),
      headers: CORS_HEADERS,
    }
  }
}

/** Handle POST requests: input deserialized from CBOR body */
export async function handleApiAction(
  key: string,
  body: Uint8Array,
  grpcClient: GRPCClient,
  queryDaemon: QueryDaemonFn,
): Promise<ApiResponse> {
  if (!key) {
    return {status: 400, body: JSON.stringify({error: 'Missing API key'}), headers: CORS_HEADERS}
  }

  const apiDefinition = APIActions[key as keyof typeof APIActions]
  if (!apiDefinition) {
    return {status: 404, body: JSON.stringify({error: `Unknown action key: ${key}`}), headers: CORS_HEADERS}
  }

  const requestSchema = HMActionSchema.options.find((schema) => schema.shape.key.value === key)
  if (!requestSchema) {
    return {status: 500, body: JSON.stringify({error: `No schema found for key: ${key}`}), headers: CORS_HEADERS}
  }

  try {
    const decodedInput = cborDecode(body)
    let validatedInput: any
    try {
      validatedInput = requestSchema.shape.input.parse(decodedInput)
    } catch (error) {
      return {
        status: 400,
        body: JSON.stringify({error: error instanceof Error ? error.message : 'Invalid request input'}),
        headers: CORS_HEADERS,
      }
    }

    const output = await apiDefinition.getData(grpcClient, validatedInput as any, queryDaemon)
    const validatedOutput = requestSchema.shape.output.parse(output)
    return {status: 200, body: JSON.stringify(serialize(validatedOutput)), headers: CORS_HEADERS}
  } catch (error) {
    console.error('API action error:', error)
    return {
      status: 500,
      body: JSON.stringify({error: error instanceof Error ? error.message : 'Unknown error'}),
      headers: CORS_HEADERS,
    }
  }
}
