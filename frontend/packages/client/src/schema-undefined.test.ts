import {describe, expect, it} from 'vitest'
import {HM_SCHEMAS, validate} from './schema-engine'

describe('undefined values are absent fields', () => {
  it('an unset optional field is not a type error', () => {
    // icon and cover are optional strings on the base metadata; unset, they are simply absent.
    expect(validate(HM_SCHEMAS['metadata']!, {name: 'Tree', icon: undefined, cover: undefined})).toEqual([])
  })
  it('an unset required field is reported missing, not mistyped', () => {
    const person = HM_SCHEMAS['example/person']!
    expect(validate(person, {name: 'Ada'})).toEqual([])
    expect(validate(person, {name: undefined})).toEqual(['$: missing required "name"'])
  })
})
