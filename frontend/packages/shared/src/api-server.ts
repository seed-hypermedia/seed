import {serialize} from 'superjson'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {HMActionSchema, HMGetRequestSchema} from '@seed-hypermedia/client/hm-types'
import {APIParams, APIQueries, APIActions} from './api'
import {deserializeQueryString} from './input-querystring'
import type {GRPCClient} from './grpc-client'
import type {QueryDaemonFn} from './api-types'
import {zodToJsonSchema} from 'zod-to-json-schema'

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

type APISchemaKind = 'query' | 'action'

type APISchemaDefinition = {
  key: string
  kind: APISchemaKind
  method: 'GET' | 'POST'
  path: string
  inputEncoding: 'query-string' | 'application/cbor'
  outputEncoding: 'application/json'
  outputSerialization: 'superjson'
  usesParamMapping: boolean
  inputSchema: any
  outputSchema: any
}

let apiSchemaDefinitionsCache: APISchemaDefinition[] | null = null

function listAPISchemaDefinitions(): APISchemaDefinition[] {
  if (apiSchemaDefinitionsCache) {
    return apiSchemaDefinitionsCache
  }

  const querySchemas = HMGetRequestSchema.options.map((requestSchema) => {
    const key = requestSchema.shape.key.value
    return {
      key,
      kind: 'query' as const,
      method: 'GET' as const,
      path: `/api/${key}`,
      inputEncoding: 'query-string' as const,
      outputEncoding: 'application/json' as const,
      outputSerialization: 'superjson' as const,
      usesParamMapping: Boolean(APIParams[key as keyof typeof APIParams]),
      inputSchema: createJSONSchema(`${key}Input`, requestSchema.shape.input, key, 'input'),
      outputSchema: createJSONSchema(`${key}Output`, requestSchema.shape.output, key, 'output'),
    }
  })

  const actionSchemas = HMActionSchema.options.map((requestSchema) => {
    const key = requestSchema.shape.key.value
    return {
      key,
      kind: 'action' as const,
      method: 'POST' as const,
      path: `/api/${key}`,
      inputEncoding: 'application/cbor' as const,
      outputEncoding: 'application/json' as const,
      outputSerialization: 'superjson' as const,
      usesParamMapping: false,
      inputSchema: createJSONSchema(`${key}Input`, requestSchema.shape.input, key, 'input'),
      outputSchema: createJSONSchema(`${key}Output`, requestSchema.shape.output, key, 'output'),
    }
  })

  apiSchemaDefinitionsCache = [...querySchemas, ...actionSchemas]
  return apiSchemaDefinitionsCache
}

function createJSONSchema(definitionName: string, schema: any, key: string, direction: 'input' | 'output') {
  const jsonSchema = withoutNumberCoercionWarnings(() =>
    zodToJsonSchema(schema, {
      name: definitionName,
    }),
  )
  applyJSONSchemaOverrides(jsonSchema, key, definitionName, direction)
  return jsonSchema
}

function withoutNumberCoercionWarnings<T>(buildSchema: () => T): T {
  const originalWarn = console.warn
  console.warn = (...args: any[]) => {
    if (
      args[0] === 'Value must be a number or a string that can be converted to a number' &&
      typeof args[1] === 'undefined'
    ) {
      return
    }
    originalWarn(...args)
  }

  try {
    return buildSchema()
  } finally {
    console.warn = originalWarn
  }
}

function applyJSONSchemaOverrides(jsonSchema: any, key: string, definitionName: string, direction: 'input' | 'output') {
  const rootDefinition = jsonSchema?.definitions?.[definitionName]
  if (!rootDefinition) {
    return
  }

  // zod-to-json-schema cannot infer the binary shape from z.custom refinements.
  if (key === 'PublishBlobs' && direction === 'input') {
    const blobProperties = rootDefinition.properties?.blobs?.items?.properties
    if (blobProperties) {
      blobProperties.data = binaryJSONSchema()
    }
  }
  if (key === 'PrepareDocumentChange' && direction === 'output') {
    if (rootDefinition.properties) {
      rootDefinition.properties.unsignedChange = binaryJSONSchema()
    }
  }
}

function binaryJSONSchema() {
  return {
    oneOf: [
      {
        type: 'string',
        contentEncoding: 'base64',
      },
      {
        type: 'array',
        items: {
          type: 'integer',
          minimum: 0,
          maximum: 255,
        },
      },
    ],
    'x-js-type': 'Uint8Array',
  }
}

function handleAPISchemaRequest(url: URL): ApiResponse {
  const keyFilter = url.searchParams.get('key')
  const kindFilter = url.searchParams.get('kind')
  if (kindFilter && kindFilter !== 'query' && kindFilter !== 'action') {
    return {
      status: 400,
      body: JSON.stringify({error: 'kind must be either query or action'}),
      headers: CORS_HEADERS,
    }
  }

  const definitions = listAPISchemaDefinitions()
  const filteredDefinitions = definitions.filter((definition) => {
    if (kindFilter && definition.kind !== kindFilter) {
      return false
    }
    if (keyFilter && definition.key !== keyFilter) {
      return false
    }
    return true
  })

  if (keyFilter) {
    const definition = filteredDefinitions[0]
    if (!definition) {
      return {
        status: 404,
        body: JSON.stringify({error: `Unknown API schema key: ${keyFilter}`}),
        headers: CORS_HEADERS,
      }
    }

    return {
      status: 200,
      body: JSON.stringify({
        ...definition,
        schemaUrl: `/api/schema?key=${encodeURIComponent(definition.key)}`,
      }),
      headers: CORS_HEADERS,
    }
  }

  return {
    status: 200,
    body: JSON.stringify({
      endpoint: '/api/schema',
      routes: filteredDefinitions.map((definition) => ({
        key: definition.key,
        kind: definition.kind,
        method: definition.method,
        path: definition.path,
        schemaUrl: `/api/schema?key=${encodeURIComponent(definition.key)}`,
      })),
    }),
    headers: CORS_HEADERS,
  }
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

  if (key === 'schema') {
    return handleAPISchemaRequest(url)
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
