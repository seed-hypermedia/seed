import {describe, expect, test} from 'vitest'
import {pathNameify} from './path'

describe('pathNameify', () => {
  test('basic slugification', () => {
    expect(pathNameify('Hello World')).toBe('hello-world')
  })

  test('preserves mid-string hyphens and underscores', () => {
    expect(pathNameify('foo-bar')).toBe('foo-bar')
    expect(pathNameify('foo_bar')).toBe('foo_bar')
  })

  test('strips leading space-derived dash', () => {
    expect(pathNameify(' hello')).toBe('hello')
  })

  test('strips trailing space-derived dash', () => {
    expect(pathNameify('hello ')).toBe('hello')
  })

  test('strips both leading and trailing space-derived dashes', () => {
    expect(pathNameify(' hello world ')).toBe('hello-world')
  })

  test('strips leading and trailing literal dashes', () => {
    expect(pathNameify('-hello-')).toBe('hello')
    expect(pathNameify('---hello---')).toBe('hello')
  })

  test('strips leading and trailing underscores', () => {
    expect(pathNameify('_hello_')).toBe('hello')
    expect(pathNameify('___hello___')).toBe('hello')
  })

  test('strips leading and trailing dots', () => {
    expect(pathNameify('.hello.')).toBe('hello')
    expect(pathNameify('...hello...')).toBe('hello')
  })

  test('strips mixed leading/trailing special chars', () => {
    expect(pathNameify('-_.hello._-')).toBe('hello')
    expect(pathNameify('._-foo bar-_.')).toBe('foo-bar')
  })

  test('returns empty string when input is only special chars', () => {
    expect(pathNameify('---')).toBe('')
    expect(pathNameify('___')).toBe('')
    expect(pathNameify('...')).toBe('')
    expect(pathNameify('-_.')).toBe('')
    expect(pathNameify('   ')).toBe('')
  })

  test('strips diacritics', () => {
    expect(pathNameify('Café')).toBe('cafe')
    expect(pathNameify('naïve')).toBe('naive')
  })

  test('replaces em-dash and collapses consecutive dashes', () => {
    expect(pathNameify('foo — bar')).toBe('foo-bar')
    expect(pathNameify('foo--bar')).toBe('foo-bar')
  })

  test('removes forward slashes', () => {
    expect(pathNameify('foo/bar')).toBe('foobar')
  })

  test('drops disallowed characters then trims', () => {
    expect(pathNameify('!@#hello!@#')).toBe('hello')
  })
})
