import {decode as cborDecode} from '@ipld/dag-cbor'
import {packHmId} from '@seed-hypermedia/client/hm-types'
import {serialize} from 'superjson'
import {describe, expect, it, vi} from 'vitest'
import {
  buildApiRequestPreview,
  coerceBinaryFields,
  createStarterPayload,
  executeApiRequest,
  type ApiSchemaDefinition,
  type JSONSchemaNode,
} from './api-lab'

const EMPTY_SCHEMA: JSONSchemaNode = {type: 'object'}

const RESOURCE_ID = {
  id: 'hm://seed',
  uid: 'seed',
  path: null,
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: null,
  latest: null,
}

function createDefinition(overrides: Partial<ApiSchemaDefinition>): ApiSchemaDefinition {
  return {
    key: 'Query',
    kind: 'query',
    method: 'GET',
    path: '/api/Query',
    schemaUrl: '/api/schema?key=Query',
    inputEncoding: 'query-string',
    outputEncoding: 'application/json',
    outputSerialization: 'superjson',
    usesParamMapping: false,
    inputSchema: EMPTY_SCHEMA,
    outputSchema: EMPTY_SCHEMA,
    ...overrides,
  }
}

describe('api-lab helpers', () => {
  it('creates starter payloads from refs, oneOf branches, arrays, enums, and binary hints', () => {
    const schema: JSONSchemaNode = {
      $ref: '#/definitions/Request',
      definitions: {
        Request: {
          type: 'object',
          required: ['id', 'mode', 'payload', 'tags', 'binary'],
          properties: {
            id: {type: 'string'},
            mode: {enum: ['full', 'lite']},
            payload: {
              oneOf: [{$ref: '#/definitions/Nested'}, {type: 'string'}],
            },
            tags: {
              type: 'array',
              items: {type: 'string'},
            },
            binary: {
              oneOf: [
                {type: 'string', contentEncoding: 'base64'},
                {type: 'array', items: {type: 'integer'}},
              ],
              'x-js-type': 'Uint8Array',
            },
          },
        },
        Nested: {
          type: 'object',
          required: ['count', 'enabled'],
          properties: {
            count: {type: 'integer'},
            enabled: {type: 'boolean', default: true},
          },
        },
      },
    }

    expect(createStarterPayload(schema, schema)).toEqual({
      id: '',
      mode: 'full',
      payload: {count: 0, enabled: true},
      tags: [],
      binary: '',
    })
  })

  it('coerces binary fields from base64 strings and byte arrays', () => {
    const schema: JSONSchemaNode = {
      type: 'object',
      required: ['primary', 'nested'],
      properties: {
        primary: {
          oneOf: [
            {type: 'string', contentEncoding: 'base64'},
            {type: 'array', items: {type: 'integer'}},
          ],
          'x-js-type': 'Uint8Array',
        },
        nested: {
          type: 'array',
          items: {
            type: 'object',
            required: ['data'],
            properties: {
              data: {
                oneOf: [
                  {type: 'string', contentEncoding: 'base64'},
                  {type: 'array', items: {type: 'integer'}},
                ],
                'x-js-type': 'Uint8Array',
              },
            },
          },
        },
      },
    }

    const coerced = coerceBinaryFields(schema, schema, {
      primary: 'AQID',
      nested: [{data: [4, 5, 6]}],
    }) as {
      primary: Uint8Array
      nested: Array<{data: Uint8Array}>
    }

    expect(Array.from(coerced.primary)).toEqual([1, 2, 3])
    expect(coerced.nested[0]).toBeDefined()
    expect(Array.from(coerced.nested[0]!.data)).toEqual([4, 5, 6])
  })

  it('builds mapped query previews for resource endpoints', () => {
    const preview = buildApiRequestPreview(
      'http://localhost:3000/',
      createDefinition({
        key: 'Resource',
        path: '/api/Resource',
        usesParamMapping: true,
      }),
      JSON.stringify(RESOURCE_ID),
    )

    expect(preview.url).toBe(`http://localhost:3000/api/Resource?id=${encodeURIComponent(packHmId(RESOURCE_ID))}`)
    expect(preview.queryParams).toEqual([{key: 'id', value: packHmId(RESOURCE_ID)}])
  })

  it('builds mapped query previews for targetId endpoints', () => {
    const preview = buildApiRequestPreview(
      'http://localhost:3000',
      createDefinition({
        key: 'ListChanges',
        path: '/api/ListChanges',
        usesParamMapping: true,
      }),
      JSON.stringify({targetId: RESOURCE_ID}),
    )

    expect(preview.url).toBe(
      `http://localhost:3000/api/ListChanges?targetId=${encodeURIComponent(packHmId(RESOURCE_ID))}`,
    )
    expect(preview.queryParams).toEqual([{key: 'targetId', value: packHmId(RESOURCE_ID)}])
  })

  it('encodes action inputs as CBOR after schema-guided binary coercion', () => {
    const actionSchema: JSONSchemaNode = {
      type: 'object',
      required: ['blobs'],
      properties: {
        blobs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['cid', 'data'],
            properties: {
              cid: {type: 'string'},
              data: {
                oneOf: [
                  {type: 'string', contentEncoding: 'base64'},
                  {type: 'array', items: {type: 'integer'}},
                ],
                'x-js-type': 'Uint8Array',
              },
            },
          },
        },
      },
    }

    const preview = buildApiRequestPreview(
      'http://localhost:3000',
      createDefinition({
        key: 'PublishBlobs',
        kind: 'action',
        method: 'POST',
        path: '/api/PublishBlobs',
        inputEncoding: 'application/cbor',
        usesParamMapping: false,
        inputSchema: actionSchema,
      }),
      JSON.stringify({
        blobs: [{cid: 'bafy-test', data: 'AQID'}],
      }),
    )

    expect(preview.method).toBe('POST')
    expect(preview.cborByteLength).toBeGreaterThan(0)
    const decodedBody = cborDecode(preview.cborBody!) as {
      blobs: Array<{cid: string; data: Uint8Array}>
    }
    expect(decodedBody.blobs[0]).toBeDefined()
    expect(decodedBody.blobs[0]!.cid).toBe('bafy-test')
    expect(Array.from(decodedBody.blobs[0]!.data)).toEqual([1, 2, 3])
  })

  it('decodes successful responses with superjson and keeps error bodies raw', async () => {
    const successFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          serialize({
            ok: true,
            bytes: new Uint8Array([7, 8, 9]),
          }),
        ),
        {
          status: 200,
          statusText: 'OK',
          headers: {'Content-Type': 'application/json'},
        },
      ),
    )

    const successResult = await executeApiRequest(
      'http://localhost:3000',
      createDefinition({key: 'Account', path: '/api/Account', usesParamMapping: true}),
      JSON.stringify('seed'),
      successFetch,
    )

    expect(successResult.ok).toBe(true)
    expect(successResult.decodedBody).toEqual({
      ok: true,
      bytes: new Uint8Array([7, 8, 9]),
    })

    const errorFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({error: 'bad request'}), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {'Content-Type': 'application/json'},
      }),
    )

    const errorResult = await executeApiRequest(
      'http://localhost:3000',
      createDefinition({key: 'Account', path: '/api/Account', usesParamMapping: true}),
      JSON.stringify('seed'),
      errorFetch,
    )

    expect(errorResult.ok).toBe(false)
    expect(errorResult.parsedBody).toEqual({error: 'bad request'})
    expect(errorResult.decodedBody).toBeUndefined()
  })
})
