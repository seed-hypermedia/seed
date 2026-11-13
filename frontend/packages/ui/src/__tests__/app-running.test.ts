import {describe, expect, it} from 'vitest'
import {appServerErrorMessage, structFields, structValue} from '../apps/running'

const schema = {
  type: 'hm://hyper.media/struct',
  properties: {
    city: {value: {type: 'hm://hyper.media/string'}, required: true, description: 'Where'},
    days: {value: {type: 'hm://hyper.media/integer'}},
    metric: {value: {type: 'hm://hyper.media/boolean'}},
  },
}

describe('app config and input forms', () => {
  it('reads the fields of an HM struct in order', () => {
    expect(structFields(schema as never)).toEqual([
      {name: 'city', kind: 'string', required: true, description: 'Where'},
      {name: 'days', kind: 'integer', required: false},
      {name: 'metric', kind: 'boolean', required: false},
    ])
    expect(structFields(undefined)).toEqual([])
  })

  it('turns form text into typed values and leaves empty fields out', () => {
    const fields = structFields(schema as never)
    expect(structValue(fields, {city: 'Lisbon', days: '3', metric: 'true'})).toEqual({
      city: 'Lisbon',
      days: 3,
      metric: true,
    })
    expect(structValue(fields, {city: 'Lisbon', days: ''})).toEqual({city: 'Lisbon'})
  })

  it('says what an app server problem means instead of failing the page', () => {
    expect(appServerErrorMessage(new Error('Unsupported action: GetAppRun'))).toBe(
      'This app server does not run apps yet',
    )
    expect(appServerErrorMessage(new TypeError('Failed to fetch'))).toBe('Not reachable')
    expect(appServerErrorMessage(new Error('Only someone who can write'))).toBe('Only someone who can write')
  })
})
