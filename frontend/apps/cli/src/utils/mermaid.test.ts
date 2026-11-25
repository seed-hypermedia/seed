import {describe, expect, it} from 'bun:test'
import {assertValidMermaid, InvalidMermaidError, parseMarkdown} from '@seed-hypermedia/client'
import {loadMermaidParser} from '@seed-hypermedia/client/mermaid-parser'

// Exercises the real mermaid parser under Bun with the linkedom shim, the way `document create`
// and `comment create` run it. The invalid sample is the one that shipped broken in October 2026:
// parentheses inside an unquoted subgraph label.
describe('mermaid validation with the real parser', () => {
  it('accepts a valid flowchart with quoted labels and a cylinder', async () => {
    const {tree} = parseMarkdown(
      '```mermaid\nflowchart LR\n  subgraph box ["The instance (one droplet)"]\n    S[(volume: blobs, SQLite)]\n  end\n  A -- HTTPS --> box\n```\n',
    )
    await expect(assertValidMermaid(tree, await loadMermaidParser())).resolves.toBeUndefined()
  })

  it('rejects an unquoted label with parentheses', async () => {
    const {tree} = parseMarkdown('```mermaid\nflowchart LR\n  subgraph box [The instance (one droplet)]\n  end\n```\n')
    const err = await assertValidMermaid(tree, await loadMermaidParser()).catch((e) => e)
    expect(err).toBeInstanceOf(InvalidMermaidError)
    expect(err.message).toContain('Parse error on line 2')
  })
})
