import {describe, expect, test} from 'vitest'
import {normalizePathInput, pathNameify, validateDomain} from './path'

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

  test('converts forward slashes to dashes', () => {
    expect(pathNameify('foo/bar')).toBe('foo-bar')
    expect(pathNameify('a/b/c')).toBe('a-b-c')
  })

  test('converts other separator-like chars to dashes', () => {
    expect(pathNameify('design + development')).toBe('design-development')
    expect(pathNameify('foo & bar')).toBe('foo-bar')
    expect(pathNameify('one, two; three | four')).toBe('one-two-three-four')
    expect(pathNameify('a@b')).toBe('a-b')
  })

  test('collapses runs of disallowed chars into a single dash', () => {
    expect(pathNameify('foo +&/ bar')).toBe('foo-bar')
    expect(pathNameify('foo!@#bar')).toBe('foo-bar')
  })

  test('drops surrounding disallowed characters then trims', () => {
    expect(pathNameify('!@#hello!@#')).toBe('hello')
  })

  test('normalizes en-dash like em-dash', () => {
    expect(pathNameify('foo – bar')).toBe('foo-bar')
  })
})

describe('normalizePathInput', () => {
  test('keeps one separator while typing, but never stores trailing dashes', () => {
    let input = ''
    for (const character of 'Hola     Adios     ') {
      input = normalizePathInput(input + character, {editing: true})
    }
    expect(input).toBe('hola-adios-')
    expect(normalizePathInput(input)).toBe('hola-adios')
  })

  test.each([
    ['——this-is-a-path', 'this-is-a-path'],
    ['hola-adios———', 'hola-adios'],
    ['Café / My_Page!', 'cafe-my_page'],
    ['___ hello ___', 'hello'],
    ['💡 ! / ', ''],
    ['hello\t\nworld', 'hello-world'],
  ])('converts %j to a final segment', (input, expected) => {
    expect(normalizePathInput(input)).toBe(expected)
    expect(pathNameify(input)).toBe(expected)
  })

  test('uses domain labels instead of document segment rules', () => {
    expect(normalizePathInput(' --My Site--. --Example--.COM--- ', {kind: 'domain'})).toBe('my-site.example.com')
    expect(normalizePathInput('My_Site ', {kind: 'subdomain', editing: true})).toBe('my-site-')
    expect(normalizePathInput('My_Site ', {kind: 'subdomain'})).toBe('my-site')
    expect(normalizePathInput('example.', {kind: 'domain', editing: true})).toBe('example.')
  })

  test('pasting a URL keeps only its host, not its path or query', () => {
    expect(normalizePathInput(' HTTPS://Example.COM/hello?x=1#section ', {kind: 'domain'})).toBe('example.com')
    expect(normalizePathInput('https://example.com:8443/page', {kind: 'domain'})).toBe('example.com')
  })

  test('preserves valid encoded international domain names', () => {
    expect(normalizePathInput('xn--caf-dma.com', {kind: 'domain'})).toBe('xn--caf-dma.com')
  })
})

describe('validateDomain', () => {
  test.each(['my-site.com', '123.example.com', 'xn--caf-dma.com'])('accepts %s', (value) => {
    expect(validateDomain(value)).toBeNull()
  })

  test.each([
    '',
    'example',
    '.example.com',
    'example..com',
    'example.com.',
    '-example.com',
    'example-.com',
    'exa_mple.com',
    'example.com:3000',
    `${'a'.repeat(64)}.com`,
    `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`,
  ])('rejects %s', (value) => {
    expect(validateDomain(value)).not.toBeNull()
  })

  test('validates hosted subdomains as a single label', () => {
    expect(validateDomain('my-site', 'subdomain')).toBeNull()
    expect(validateDomain('my.site', 'subdomain')).not.toBeNull()
    expect(validateDomain('a'.repeat(64), 'subdomain')).not.toBeNull()
  })
})
