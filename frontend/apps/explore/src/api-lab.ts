import {encode as cborEncode} from '@ipld/dag-cbor'
import {packHmId, type HMGetRequest, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {serializeQueryString} from '@shm/shared/input-querystring'
import {deserialize} from 'superjson'

/** JSON Schema nodes returned by the desktop API schema endpoint. */
export type JSONSchemaNode = {
  $ref?: string
  title?: string
  description?: string
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  default?: unknown
  properties?: Record<string, JSONSchemaNode>
  required?: string[]
  items?: JSONSchemaNode | JSONSchemaNode[]
  oneOf?: JSONSchemaNode[]
  anyOf?: JSONSchemaNode[]
  definitions?: Record<string, JSONSchemaNode>
  additionalProperties?: boolean | JSONSchemaNode
  contentEncoding?: string
  format?: string
  'x-js-type'?: string
}

/** Supported desktop API schema categories. */
export type ApiSchemaKind = 'query' | 'action'

/** Summary rows returned by `GET /api/schema`. */
export type ApiSchemaRouteSummary = {
  key: string
  kind: ApiSchemaKind
  method: 'GET' | 'POST'
  path: string
  schemaUrl: string
}

/** Schema index returned by `GET /api/schema`. */
export type ApiSchemaIndex = {
  endpoint: string
  routes: ApiSchemaRouteSummary[]
}

/** Detailed schema document returned by `GET /api/schema?key=...`. */
export type ApiSchemaDefinition = ApiSchemaRouteSummary & {
  inputEncoding: 'query-string' | 'application/cbor'
  outputEncoding: 'application/json'
  outputSerialization: 'superjson'
  usesParamMapping: boolean
  inputSchema: JSONSchemaNode
  outputSchema: JSONSchemaNode
}

/** Transport preview for a single playground request. */
export type ApiRequestPreview = {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  logicalInput: unknown
  queryParams?: Array<{key: string; value: string}>
  cborBody?: Uint8Array
  cborByteLength?: number
}

/** Parsed request/response data produced by the playground executor. */
export type ApiExecutionResult = {
  preview: ApiRequestPreview
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  rawBody: string
  parsedBody?: unknown
  decodedBody?: unknown
}

const QUERY_PARAM_SERIALIZERS: Partial<Record<HMGetRequest['key'], (input: any) => Record<string, string>>> = {
  Account: (input: string) => ({id: input}),
  Resource: (input: UnpackedHypermediaId) => ({id: packHmId(input)}),
  ResourceMetadata: (input: UnpackedHypermediaId) => ({id: packHmId(input)}),
  ListCitations: (input: {targetId: UnpackedHypermediaId}) => ({
    targetId: packHmId(input.targetId),
  }),
  ListChanges: (input: {targetId: UnpackedHypermediaId}) => ({
    targetId: packHmId(input.targetId),
  }),
  ListCapabilities: (input: {targetId: UnpackedHypermediaId}) => ({
    targetId: packHmId(input.targetId),
  }),
}

/** Resolves a schema node, following local `$ref` pointers inside the same document. */
export function resolveSchemaNode(
  rootSchema: JSONSchemaNode,
  schema: JSONSchemaNode,
  visitedRefs = new Set<string>(),
): JSONSchemaNode {
  if (!schema.$ref) {
    return schema
  }

  if (visitedRefs.has(schema.$ref)) {
    return schema
  }

  const resolvedRef = resolveLocalRef(rootSchema, schema.$ref)
  const {$ref: _ignoredRef, ...rest} = schema
  return resolveSchemaNode(rootSchema, {...resolvedRef, ...rest}, new Set([...visitedRefs, schema.$ref]))
}

/** Generates a starter JSON payload from the selected JSON Schema document. */
export function createStarterPayload(
  rootSchema: JSONSchemaNode,
  schema: JSONSchemaNode,
  visitedRefs = new Set<string>(),
): unknown {
  if (schema.$ref) {
    if (visitedRefs.has(schema.$ref)) {
      return {}
    }
    const resolvedRef = resolveLocalRef(rootSchema, schema.$ref)
    const {$ref: _ignoredRef, ...rest} = schema
    return createStarterPayload(rootSchema, {...resolvedRef, ...rest}, new Set([...visitedRefs, schema.$ref]))
  }

  if (schema['x-js-type'] === 'Uint8Array') {
    return ''
  }

  if (schema.default !== undefined) {
    return schema.default
  }

  if (schema.const !== undefined) {
    return schema.const
  }

  if (schema.enum?.length) {
    return schema.enum[0]
  }

  const variants = schema.oneOf ?? schema.anyOf
  if (variants?.length) {
    const firstVariant = variants[0]
    if (firstVariant) {
      return createStarterPayload(rootSchema, firstVariant, visitedRefs)
    }
  }

  const schemaType = getSchemaType(schema)
  if (schemaType === 'object' || (!schemaType && schema.properties)) {
    const starterObject: Record<string, unknown> = {}
    for (const requiredKey of schema.required ?? []) {
      const propertySchema = schema.properties?.[requiredKey]
      if (propertySchema) {
        starterObject[requiredKey] = createStarterPayload(rootSchema, propertySchema, visitedRefs)
      }
    }
    return starterObject
  }

  if (schemaType === 'array') {
    return []
  }

  if (schemaType === 'integer' || schemaType === 'number') {
    return 0
  }

  if (schemaType === 'boolean') {
    return false
  }

  if (schemaType === 'string') {
    return ''
  }

  return null
}

/** Coerces JSON editor values into transport-ready values using schema hints such as `Uint8Array`. */
export function coerceBinaryFields(
  rootSchema: JSONSchemaNode,
  schema: JSONSchemaNode,
  value: unknown,
  visitedRefs = new Set<string>(),
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (schema.$ref) {
    if (visitedRefs.has(schema.$ref)) {
      return value
    }
    const resolvedRef = resolveLocalRef(rootSchema, schema.$ref)
    const {$ref: _ignoredRef, ...rest} = schema
    return coerceBinaryFields(rootSchema, {...resolvedRef, ...rest}, value, new Set([...visitedRefs, schema.$ref]))
  }

  if (schema['x-js-type'] === 'Uint8Array') {
    return coerceUint8Array(value)
  }

  const variants = schema.oneOf ?? schema.anyOf
  if (variants?.length) {
    let lastError: Error | null = null
    for (const variant of variants) {
      try {
        return coerceBinaryFields(rootSchema, variant, value, visitedRefs)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
    if (lastError) {
      throw lastError
    }
  }

  const schemaType = getSchemaType(schema)
  if (schemaType === 'array' && Array.isArray(value)) {
    const itemSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items
    if (!itemSchema) {
      return value
    }
    return value.map((item) => coerceBinaryFields(rootSchema, itemSchema, item, visitedRefs))
  }

  if ((schemaType === 'object' || (!schemaType && schema.properties)) && isRecord(value)) {
    const nextValue: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const propertySchema =
        schema.properties?.[key] ??
        (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined)
      nextValue[key] = propertySchema ? coerceBinaryFields(rootSchema, propertySchema, entry, visitedRefs) : entry
    }
    return nextValue
  }

  return value
}

/** Builds the exact HTTP request preview that the playground will send. */
export function buildApiRequestPreview(
  apiHost: string,
  definition: ApiSchemaDefinition,
  inputText: string,
): ApiRequestPreview {
  const parsedInput = parseJsonInput(inputText)
  const normalizedHost = normalizeApiHost(apiHost)
  const requestUrl = `${normalizedHost}${definition.path}`

  if (definition.method === 'GET') {
    const search = buildQueryString(definition.key, parsedInput)
    const finalUrl = search ? `${requestUrl}${search}` : requestUrl
    const params = Array.from(new URLSearchParams(search).entries()).map(([key, value]) => ({
      key,
      value,
    }))

    return {
      method: 'GET',
      url: finalUrl,
      headers: {
        Accept: 'application/json',
      },
      logicalInput: parsedInput,
      queryParams: params,
    }
  }

  const transportInput = coerceBinaryFields(definition.inputSchema, definition.inputSchema, parsedInput)
  const cborBody = new Uint8Array(cborEncode(transportInput))

  return {
    method: 'POST',
    url: requestUrl,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/cbor',
    },
    logicalInput: transportInput,
    cborBody,
    cborByteLength: cborBody.byteLength,
  }
}

/** Executes the exact HTTP request described by the current playground selection. */
export async function executeApiRequest(
  apiHost: string,
  definition: ApiSchemaDefinition,
  inputText: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ApiExecutionResult> {
  const preview = buildApiRequestPreview(apiHost, definition, inputText)
  const response = await fetchImpl(preview.url, {
    method: preview.method,
    headers: preview.headers,
    body: preview.cborBody ? (preview.cborBody as unknown as BodyInit) : undefined,
  })

  const rawBody = await response.text()
  const parsedBody = parseJsonBody(rawBody)
  const headers = Object.fromEntries(response.headers.entries())

  return {
    preview,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    rawBody,
    parsedBody,
    decodedBody: response.ok && parsedBody !== undefined ? deserialize(parsedBody as any) : undefined,
  }
}

function buildQueryString(key: string, input: unknown): string {
  const mappedSerializer = QUERY_PARAM_SERIALIZERS[key as HMGetRequest['key']]
  if (!mappedSerializer) {
    return serializeQueryString(input as never)
  }

  const searchParams = new URLSearchParams(mappedSerializer(input))
  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

function coerceUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }

  if (typeof value === 'string') {
    return decodeBase64(value)
  }

  if (Array.isArray(value)) {
    if (!value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
      throw new Error('Binary arrays must contain integers between 0 and 255.')
    }
    return new Uint8Array(value)
  }

  throw new Error('Binary fields must be provided as a base64 string or an array of bytes.')
}

function decodeBase64(input: string): Uint8Array {
  const trimmedInput = input.trim()
  if (!trimmedInput) {
    return new Uint8Array()
  }

  const bufferConstructor = (
    globalThis as typeof globalThis & {
      Buffer?: {from(input: string, encoding: string): Uint8Array}
    }
  ).Buffer
  if (bufferConstructor) {
    return new Uint8Array(bufferConstructor.from(trimmedInput, 'base64'))
  }

  if (typeof globalThis.atob === 'function') {
    const binaryString = globalThis.atob(trimmedInput)
    const bytes = new Uint8Array(binaryString.length)
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index)
    }
    return bytes
  }

  throw new Error('Base64 decoding is unavailable in this environment.')
}

function getSchemaType(schema: JSONSchemaNode): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((type) => type !== 'null') ?? schema.type[0]
  }
  return schema.type
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeApiHost(apiHost: string): string {
  return apiHost.replace(/\/+$/, '')
}

function parseJsonInput(inputText: string): unknown {
  const trimmedInput = inputText.trim()
  if (!trimmedInput) {
    throw new Error('Input JSON is empty.')
  }
  return JSON.parse(trimmedInput)
}

function parseJsonBody(rawBody: string): unknown {
  if (!rawBody) {
    return undefined
  }

  try {
    return JSON.parse(rawBody)
  } catch {
    return undefined
  }
}

function resolveLocalRef(rootSchema: JSONSchemaNode, ref: string): JSONSchemaNode {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported schema reference: ${ref}`)
  }

  let currentValue: unknown = rootSchema
  for (const segment of ref.slice(2).split('/')) {
    if (!isRecord(currentValue) || !(segment in currentValue)) {
      throw new Error(`Unable to resolve schema reference: ${ref}`)
    }
    currentValue = currentValue[segment]
  }

  if (!currentValue || typeof currentValue !== 'object') {
    throw new Error(`Schema reference does not point to an object: ${ref}`)
  }

  return currentValue as JSONSchemaNode
}
