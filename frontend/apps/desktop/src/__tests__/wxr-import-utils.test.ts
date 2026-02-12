import {describe, expect, it} from 'vitest'
import {
  createAuthorKeyName,
  extractSlugFromLink,
  isEmailUsableForAuthored,
  normalizeAuthorLogin,
  normalizeWXRSlug,
} from '../wxr-import-utils'

describe('normalizeAuthorLogin', () => {
  it('trims whitespace from author logins', () => {
    expect(normalizeAuthorLogin('  theme-reviewer  ')).toBe('theme-reviewer')
  })

  it('returns empty string for nullish values', () => {
    expect(normalizeAuthorLogin(undefined)).toBe('')
    expect(normalizeAuthorLogin(null)).toBe('')
  })

  it('normalizes malformed cdata and angle-bracket logins', () => {
    expect(normalizeAuthorLogin('<![CDATA[ThemeReviewer]]>')).toBe(
      'themereviewer',
    )
    expect(normalizeAuthorLogin('>themereviewteam')).toBe('themereviewteam')
    expect(normalizeAuthorLogin('themereviewteam>')).toBe('themereviewteam')
  })
})

describe('isEmailUsableForAuthored', () => {
  it('accepts valid email addresses', () => {
    expect(isEmailUsableForAuthored('author@example.com')).toBe(true)
  })

  it('rejects empty or malformed email addresses', () => {
    expect(isEmailUsableForAuthored('')).toBe(false)
    expect(isEmailUsableForAuthored('invalid-email')).toBe(false)
  })
})

describe('createAuthorKeyName', () => {
  it('creates deterministic keys for the same login', () => {
    const keyA = createAuthorKeyName('siteA', 'theme reviewer')
    const keyB = createAuthorKeyName('siteA', 'theme reviewer')
    expect(keyA).toBe(keyB)
  })

  it('creates distinct keys for different logins', () => {
    const keyA = createAuthorKeyName('siteA', 'theme-reviewer')
    const keyB = createAuthorKeyName('siteA', 'theme-buster')
    expect(keyA).not.toBe(keyB)
  })

  it('creates distinct keys for same login in different scopes', () => {
    const keyA = createAuthorKeyName('siteA', 'theme-reviewer')
    const keyB = createAuthorKeyName('siteB', 'theme-reviewer')
    expect(keyA).not.toBe(keyB)
  })
})

describe('extractSlugFromLink', () => {
  it('extracts last segment from full URL with date path', () => {
    expect(
      extractSlugFromLink(
        'https://wpthemetestdata.wordpress.com/2018/10/20/keyboard-navigation/',
      ),
    ).toBe('keyboard-navigation')
  })

  it('extracts last segment from flat URL', () => {
    expect(
      extractSlugFromLink(
        'https://wpthemetestdata.wordpress.com/wp-6-1-font-size-scale/',
      ),
    ).toBe('wp-6-1-font-size-scale')
  })

  it('handles URL without trailing slash', () => {
    expect(
      extractSlugFromLink('https://example.com/2010/09/10/post-format-gallery'),
    ).toBe('post-format-gallery')
  })

  it('returns null for empty or nullish input', () => {
    expect(extractSlugFromLink('')).toBeNull()
    expect(extractSlugFromLink(null)).toBeNull()
    expect(extractSlugFromLink(undefined)).toBeNull()
  })

  it('returns null for root URL with no path segments', () => {
    expect(extractSlugFromLink('https://example.com/')).toBeNull()
    expect(extractSlugFromLink('https://example.com')).toBeNull()
  })

  it('handles percent-encoded unicode slugs', () => {
    expect(
      extractSlugFromLink(
        'https://example.com/greek/%CE%B5%CF%80%CE%AF%CF%80%CE%B5%CE%B4%CE%BF-2/',
      ),
    ).toBe('%CE%B5%CF%80%CE%AF%CF%80%CE%B5%CE%B4%CE%BF-2')
  })
})

describe('normalizeWXRSlug', () => {
  it('decodes percent-encoded unicode slugs', () => {
    expect(
      normalizeWXRSlug('%CE%B5%CF%80%CE%B9%CE%B5%CE%AF%CE%BE%CE%B7', 7),
    ).toBe('επιείξη')
  })

  it('falls back to post id when slug is empty', () => {
    expect(normalizeWXRSlug('', 42)).toBe('post-42')
  })

  it('normalizes unsafe path characters', () => {
    expect(normalizeWXRSlug('/foo/bar?baz', 5)).toBe('foo-bar-baz')
  })
})
