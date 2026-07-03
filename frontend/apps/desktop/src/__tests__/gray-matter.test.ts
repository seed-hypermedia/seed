import {describe, expect, it} from 'vitest'
import matter from 'gray-matter'

describe('gray-matter dependency', () => {
  it('parses YAML frontmatter in the desktop renderer bundle', () => {
    const parsed = matter('---\ntitle: Imported document\n---\n# Body')

    expect(parsed.data).toEqual({title: 'Imported document'})
    expect(parsed.content.trim()).toBe('# Body')
  })
})
