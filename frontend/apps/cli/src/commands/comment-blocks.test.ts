/**
 * Unit tests for `textToBlocks` — the comment Markdown parser.
 *
 * Regression coverage for the bug where `seed-cli comment create --file`
 * stored Markdown source as literal plain text instead of parsing inline
 * formatting (see `seed-cli-comment-markdown-bug` report).
 */

import {describe, test, expect} from 'bun:test'
import {textToBlocks} from './comment-blocks'

let counter = 0
const fakeId = () => `blk-${counter++}`

function findAnnotation(annotations: any[], type: string) {
  return annotations.find((a) => a.type === type)
}

describe('comment textToBlocks', () => {
  test('empty input produces a single empty Paragraph', () => {
    const blocks = textToBlocks('', fakeId)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]!.block as any
    expect(block.type).toBe('Paragraph')
    expect(block.text).toBe('')
    expect(block.annotations).toEqual([])
  })

  test('whitespace-only input produces a single empty Paragraph', () => {
    const blocks = textToBlocks('   \n  \n', fakeId)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]!.block as any
    expect(block.type).toBe('Paragraph')
    expect(block.text).toBe('')
  })

  test('plain text becomes a Paragraph block with no annotations', () => {
    const blocks = textToBlocks('Hello world', fakeId)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]!.block as any
    expect(block.type).toBe('Paragraph')
    expect(block.text).toBe('Hello world')
    expect(block.annotations).toEqual([])
  })

  test('bold markdown is parsed into a Bold annotation (regression)', () => {
    const blocks = textToBlocks('Hello **world**', fakeId)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]!.block as any
    expect(block.text).toBe('Hello world')
    const bold = findAnnotation(block.annotations, 'Bold')
    expect(bold).toBeDefined()
    expect(bold.starts).toEqual([6])
    expect(bold.ends).toEqual([11])
  })

  test('inline code is parsed into a Code annotation (regression)', () => {
    const blocks = textToBlocks('Account: `z6Mk123`', fakeId)
    const block = blocks[0]!.block as any
    expect(block.text).toBe('Account: z6Mk123')
    const code = findAnnotation(block.annotations, 'Code')
    expect(code).toBeDefined()
    expect(code.starts).toEqual([9])
    expect(code.ends).toEqual([16])
  })

  test('markdown links become Link annotations (regression)', () => {
    const blocks = textToBlocks('See [the docs](https://example.com) for more', fakeId)
    const block = blocks[0]!.block as any
    expect(block.text).toBe('See the docs for more')
    const link = findAnnotation(block.annotations, 'Link')
    expect(link).toBeDefined()
    expect(link.link).toBe('https://example.com')
    expect(link.starts).toEqual([4])
    expect(link.ends).toEqual([12])
  })

  test('external angle-bracket autolinks become Link annotations spanning the URL', () => {
    // Embed annotations render as mention chips and break for non-hm URLs,
    // so external autolinks must be plain Links.
    const blocks = textToBlocks('Profile: <https://example.com/user>', fakeId)
    const block = blocks[0]!.block as any
    expect(block.text).toBe('Profile: https://example.com/user')
    expect(block.text).not.toContain('￼')
    const link = findAnnotation(block.annotations, 'Link')
    expect(link).toBeDefined()
    expect(link.link).toBe('https://example.com/user')
    expect(link.starts).toEqual([9])
    expect(link.ends).toEqual([9 + 'https://example.com/user'.length])
    expect(findAnnotation(block.annotations, 'Embed')).toBeUndefined()
  })

  test('hm:// angle-bracket autolinks become Embed annotations on U+FFFC', () => {
    const blocks = textToBlocks('cc <hm://z6Mktest/:profile>', fakeId)
    const block = blocks[0]!.block as any
    expect(block.text).toBe('cc ￼')
    const embed = findAnnotation(block.annotations, 'Embed')
    expect(embed).toBeDefined()
    expect(embed.link).toBe('hm://z6Mktest/:profile')
  })

  test('the bug-report payload now produces real annotations, not literal text', () => {
    const input = [
      'Done — I created the new Seed identity/key **Seed Team Agent** and published its profile.',
      '',
      'Account: `z6Mkk1Lnazfyfu1u2qEEjzdw2TvZ7genh9rgkjyEuTQVpizs`',
      'Profile: <https://hyper.media/hm/z6Mkk1Lnazfyfu1u2qEEjzdw2TvZ7genh9rgkjyEuTQVpizs/seed-team-agent>',
    ].join('\n')

    const blocks = textToBlocks(input, fakeId)

    const allText = blocks.map((b) => (b.block as any).text).join(' ')
    // Markdown delimiters must be stripped from the rendered text.
    expect(allText).not.toContain('**')
    expect(allText).not.toContain('`z6Mkk1')

    const allAnnotations = blocks.flatMap((b) => (b.block as any).annotations as any[])
    expect(allAnnotations.some((a) => a.type === 'Bold')).toBe(true)
    expect(allAnnotations.some((a) => a.type === 'Code')).toBe(true)
    // External autolinks become Link annotations (not Embed — that would render as "ERROR").
    expect(allAnnotations.some((a) => a.type === 'Link' && a.link?.startsWith('https://'))).toBe(true)
    expect(allAnnotations.some((a) => a.type === 'Embed' && a.link?.startsWith('https://'))).toBe(false)
  })

  test('headings are parsed as Heading blocks (was wrapped in Paragraph before fix)', () => {
    const blocks = textToBlocks('# Title\n\nBody text', fakeId)
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    const head = blocks[0]!.block as any
    expect(head.type).toBe('Heading')
    expect(head.text).toBe('Title')
  })

  test('bullet lists are parsed as Unordered list containers', () => {
    const blocks = textToBlocks('- one\n- two\n- three', fakeId)
    expect(blocks).toHaveLength(1)
    const root = blocks[0]!
    expect((root.block as any).attributes?.childrenType).toBe('Unordered')
    expect(root.children).toBeDefined()
    expect(root.children!.length).toBe(3)
  })

  test('fenced code blocks are parsed as Code blocks', () => {
    const blocks = textToBlocks('```sh\necho hi\n```', fakeId)
    expect(blocks).toHaveLength(1)
    const block = blocks[0]!.block as any
    expect(block.type).toBe('Code')
    expect(block.text).toBe('echo hi')
  })
})
