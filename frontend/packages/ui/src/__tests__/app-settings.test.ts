import {describe, expect, it} from 'vitest'
import {configSchema} from '../apps/app-settings'

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
