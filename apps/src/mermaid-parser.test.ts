import {describe, expect, test} from 'bun:test'
import {loadMermaidParser, mermaidSelfcheck} from './mermaid-parser'

describe('bundled mermaid parser', () => {
  test('parses a valid diagram and rejects a broken one through the DOM shim', async () => {
    const parse = await loadMermaidParser()
    await expect(parse('flowchart LR\n  a --> b')).resolves.toBeDefined()
    await expect(parse('flowchart LR\n  subgraph box [The instance (one droplet)]\n  end')).rejects.toThrow()
  })

  test('the packaging selfcheck passes against the same loader', async () => {
    await expect(mermaidSelfcheck()).resolves.toBeUndefined()
  })
})
