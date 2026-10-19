import {describe, expect, it} from 'vitest'
import {MarkdownFrontmatterError, parseFrontmatter, parseMarkdown} from '../src/markdown-to-blocks'

const invalid = `---
title: Enterprise Edition: security and privacy model
summary: What the instance keeps private
---

# Heading
`

describe('frontmatter parsing', () => {
  it('throws on invalid YAML instead of leaking the block into the body', () => {
    expect(() => parseMarkdown(invalid)).toThrow(MarkdownFrontmatterError)
    expect(() => parseMarkdown(invalid)).toThrow(/Invalid YAML in frontmatter/)
    expect(() => parseMarkdown(invalid)).toThrow(/Quote values that contain a colon/)
  })

  it('accepts a quoted value with a colon and maps title to name', () => {
    const {tree, metadata} = parseMarkdown(invalid.replace(/^title: (.*)$/m, 'title: "$1"'))
    expect(metadata.name).toBe('Enterprise Edition: security and privacy model')
    expect(metadata.summary).toBe('What the instance keeps private')
    expect(tree[0]?.block.type).toBe('Heading')
  })

  it('keeps the legacy fallthrough when strictFrontmatter is false', () => {
    const {content, metadata} = parseFrontmatter(invalid, {strictFrontmatter: false})
    expect(metadata).toEqual({})
    expect(content.startsWith('---')).toBe(true)
    const {tree} = parseMarkdown(invalid, {strictFrontmatter: false})
    expect(tree[0]?.block.type).toBe('Paragraph')
  })

  it('leaves markdown without frontmatter alone', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({content: '# Just a heading\n', metadata: {}})
    expect(parseFrontmatter('---\n---\nbody\n').metadata).toEqual({})
  })
})
