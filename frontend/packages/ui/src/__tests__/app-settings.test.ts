import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {configSchema, missingConfig, toolConfigFields, withoutDefaults, withToolFields} from '../apps/app-settings'

describe('app config schemas', () => {
  it('keeps a struct with fields as it is, whatever the field schemas', () => {
    const schema = {
      type: 'hm://hyper.media/struct',
      properties: {
        apiKey: {value: {type: 'hm://hyper.media/string'}, required: true},
        cities: {value: {type: 'hm://hyper.media/list', items: {type: 'hm://hyper.media/string'}}},
      },
    }
    expect(configSchema(schema)).toBe(schema)
  })

  it('has no schema without fields', () => {
    expect(configSchema({type: 'hm://hyper.media/struct', properties: {}})).toBeNull()
  })
})

describe('the schema of secrets', () => {
  it('carries no default, because a schema is published and a default in it would publish the secret', () => {
    const schema = {
      type: 'hm://hyper.media/struct',
      properties: {
        api_key: {value: {type: 'hm://hyper.media/string'}, required: true, description: 'Datalab key', default: 'k-1'},
        region: {value: {type: 'hm://hyper.media/string'}},
      },
    }
    expect(withoutDefaults(schema)).toEqual({
      type: 'hm://hyper.media/struct',
      properties: {
        api_key: {value: {type: 'hm://hyper.media/string'}, required: true, description: 'Datalab key'},
        region: {value: {type: 'hm://hyper.media/string'}},
      },
    })
    // A schema with no defaults is kept as it is, so nothing is republished for no reason.
    const plain = {type: 'hm://hyper.media/struct', properties: {token: {value: {type: 'hm://hyper.media/string'}}}}
    expect(withoutDefaults(plain)).toBe(plain)
  })
})

describe('the config an app asks for', () => {
  const convert = hmId('alice', {path: ['importer', 'convert']})
  const notes = hmId('alice', {path: ['importer', 'notes']})
  const client = {
    request: async (key: string, input: {id?: string}) => {
      if (key !== 'Resource') throw new Error(`unexpected ${key}`)
      if (input.id === convert.id)
        return {
          type: 'document',
          document: {
            metadata: {
              name: 'convert',
              type: 'hm://hyper.media/tool',
              // A schema of the bundled library, so the test fetches nothing: it has a `name` field.
              privateConfigSchema: 'hm://hyper.media/example/person',
            },
          },
        }
      // A page the app also lists declares nothing.
      return {type: 'document', document: {metadata: {name: 'Notes', type: 'hm://hyper.media/page'}}}
    },
  }

  it('includes what each of its tools declares, saying which tool needs it', async () => {
    const fields = await toolConfigFields(client as never, [convert, notes])
    expect(fields.publicFields).toEqual([])
    expect(fields.privateFields.map((field) => field.name)).toContain('name')
    expect(fields.privateFields.every((field) => field.description?.includes('convert'))).toBe(true)
  })

  it('lists its own fields first, and a tool’s field only under a name the app does not use', () => {
    const own = [{name: 'apiKey', kind: 'string', required: true}]
    const fromTools = [
      {name: 'apiKey', kind: 'string', required: true, description: 'For convert'},
      {name: 'region', kind: 'string', required: false, description: 'For convert'},
      {name: 'region', kind: 'string', required: false, description: 'For other'},
    ]
    expect(withToolFields(own, fromTools)).toEqual([own[0], fromTools[1]])
    expect(withToolFields(own, undefined)).toEqual(own)
  })

  it('names the required config it lacks: public values not filled, and secrets a running app does not hold', () => {
    const fields = {
      publicFields: [
        {name: 'mode', kind: 'string', required: true},
        {name: 'extras', kind: 'string', required: false},
      ],
      privateFields: [
        {name: 'datalabApiKey', kind: 'string', required: true},
        {name: 'spare', kind: 'string', required: false},
      ],
    }
    expect(missingConfig({...fields, publicConfig: {}, privateKeys: []})).toEqual({
      public: ['mode'],
      private: ['datalabApiKey'],
    })
    expect(missingConfig({...fields, publicConfig: {mode: 'fast'}, privateKeys: ['datalabApiKey']})).toEqual({
      public: [],
      private: [],
    })
    // An app that does not run holds no secrets yet: running it is when they are asked for.
    expect(missingConfig({...fields, publicConfig: {mode: ''}, privateKeys: null})).toEqual({
      public: ['mode'],
      private: [],
    })
  })
})
