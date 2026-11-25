import {describe, expect, it} from 'vitest'
import {
  assertValidMermaid,
  collectMermaidBlocks,
  InvalidMermaidError,
  validateMermaidBlocks,
  type MermaidParser,
} from '../src/mermaid-validation'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '../src/markdown-to-blocks'

const doc = `# Title

\`\`\`mermaid
flowchart LR
  a --> b
\`\`\`

- item
  \`\`\`Mermaid
  broken [
  \`\`\`

\`\`\`js
console.log('not a diagram')
\`\`\`
`

/** Fails any source containing "broken". */
const fakeParser: MermaidParser = async (source) => {
  if (source.includes('broken')) throw new Error('Parse error on line 1:\nbroken [\n-------^')
  return {diagramType: 'flowchart-v2'}
}

describe('collectMermaidBlocks', () => {
  it('finds mermaid Code blocks at any depth in both tree shapes, case-insensitively', () => {
    const {tree} = parseMarkdown(doc)
    const fromTree = collectMermaidBlocks(tree)
    const fromHm = collectMermaidBlocks(markdownBlockNodesToHMBlockNodes(tree))
    expect(fromTree.map((b) => b.source.trim())).toEqual(['flowchart LR\n  a --> b', 'broken ['])
    expect(fromHm.map((b) => b.source.trim())).toEqual(fromTree.map((b) => b.source.trim()))
    expect(fromHm.every((b) => b.blockId.length > 0)).toBe(true)
  })
})

describe('validateMermaidBlocks', () => {
  it('reports only the failing diagrams with a one-line message', async () => {
    const {tree} = parseMarkdown(doc)
    const errors = await validateMermaidBlocks(tree, fakeParser)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe('Parse error on line 1: broken [ -------^')
    expect(errors[0]!.blockId).toBe(collectMermaidBlocks(tree)[1]!.blockId)
    expect(errors[0]!.blockId).not.toBe('')
  })

  it('treats an empty diagram as an error', async () => {
    const nodes = [{block: {id: 'x', type: 'Code', language: 'mermaid', text: '  \n'}, children: []}]
    expect(await validateMermaidBlocks(nodes, fakeParser)).toEqual([{blockId: 'x', message: 'empty diagram'}])
  })
})

describe('assertValidMermaid', () => {
  it('passes a document with only valid diagrams', async () => {
    const {tree} = parseMarkdown('```mermaid\nflowchart LR\n  a --> b\n```\n')
    await expect(assertValidMermaid(tree, fakeParser)).resolves.toBeUndefined()
  })

  it('throws InvalidMermaidError naming the block', async () => {
    const {tree} = parseMarkdown(doc)
    const err = await assertValidMermaid(tree, fakeParser).catch((e) => e)
    expect(err).toBeInstanceOf(InvalidMermaidError)
    expect(err.message).toMatch(/^Invalid mermaid diagram: block .*: Parse error on line 1/)
    expect(err.errors).toHaveLength(1)
  })
})
