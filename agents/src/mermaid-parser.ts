/**
 * Mermaid parser for the agents runtime.
 *
 * `@seed-hypermedia/client/mermaid-parser` imports `mermaid` and `linkedom` by computed
 * specifier so bundlers leave them out, which suits the CLI (they are runtime dependencies next
 * to it) and browsers (they have a DOM). The server bundle and the compiled desktop binary ship
 * no node_modules besides the staged microsandbox runtime, so there those imports threw "Cannot
 * find package 'linkedom'" on every document write. Importing both by literal specifier here
 * makes Bun carry them inside the bundle, the same way the rest of the runtime's dependencies
 * travel. `--exec-selfcheck` parses a diagram through this loader so a packaging regression fails
 * the image or binary build instead of the first write in production.
 */
import {parseHTML} from 'linkedom'
import type {MermaidParser} from '@seed-hypermedia/client/mermaid-validation'

let loader: Promise<MermaidParser> | undefined

/** mermaid's sanitizer initialises against `window.document`; give it one before it loads. */
function installDomShim(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g.document !== 'undefined') return
  const dom = parseHTML('<!doctype html><html><body></body></html>') as unknown as Record<string, unknown>
  g.window = dom.window
  g.document = dom.document
  g.DOMParser = dom.DOMParser
  if (typeof g.navigator === 'undefined') g.navigator = {userAgent: 'node'}
}

/** Loads mermaid once, after the DOM shim, and shares the parser across writes. */
export function loadMermaidParser(): Promise<MermaidParser> {
  if (!loader) {
    loader = (async () => {
      installDomShim()
      // A literal dynamic import: bundled, but evaluated only after the shim is installed.
      const {default: mermaid} = await import('mermaid')
      return (source: string) => mermaid.parse(source)
    })()
    loader.catch(() => {
      loader = undefined
    })
  }
  return loader
}

/** Parses one valid and one invalid diagram; throws when the bundled parser does not behave. */
export async function mermaidSelfcheck(): Promise<void> {
  const parse = await loadMermaidParser()
  await parse('flowchart LR\n  a --> b')
  let rejected = false
  try {
    await parse('flowchart LR\n  subgraph box [The instance (one droplet)]\n  end')
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('mermaid selfcheck accepted an invalid diagram')
}
