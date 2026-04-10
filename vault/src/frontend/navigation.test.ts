import {afterEach, describe, expect, test} from 'bun:test'
import * as navigation from './navigation'

describe('withHash', () => {
  const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`

  afterEach(() => {
    history.replaceState(null, '', originalPath)
  })

  test('preserves the current hash for string targets without a hash', () => {
    history.replaceState(null, '', '/vault')
    window.location.hash = '/a/alice'

    expect(navigation.withHash('/login')).toBe('/login#/a/alice')
  })

  test('preserves the current hash for object targets without a hash', () => {
    history.replaceState(null, '', '/vault')
    window.location.hash = '/a/alice'

    expect(navigation.withHash({pathname: '/settings'})).toEqual({
      pathname: '/settings',
      hash: '#/a/alice',
    })
  })

  test('leaves explicit hashes unchanged', () => {
    history.replaceState(null, '', '/vault')
    window.location.hash = '/a/alice'

    expect(navigation.withHash('/login#/delegate')).toBe('/login#/delegate')
    expect(navigation.withHash({pathname: '/settings', hash: '#/delegate'})).toEqual({
      pathname: '/settings',
      hash: '#/delegate',
    })
  })
})
