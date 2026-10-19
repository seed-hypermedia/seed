/**
 * Loads mermaid's parser for {@link assertValidMermaid} in whatever runtime this runs in.
 *
 * Kept apart from `mermaid-validation.ts` so that importing the validator never pulls mermaid
 * into a bundle. `mermaid` is a peer the caller installs; outside a browser a DOM shim is needed
 * too (mermaid's sanitizer initialises against `window.document`), and `linkedom` is used when
 * present. Both are imported dynamically with computed specifiers so bundlers leave them alone.
 */

import type {MermaidParser} from './mermaid-validation'

let loader: Promise<MermaidParser> | undefined

async function installDomShim(): Promise<void> {
  const g = globalThis as Record<string, unknown>
  if (typeof g.document !== 'undefined') return
  const specifier = 'linkedom'
  const {parseHTML} = (await import(/* @vite-ignore */ specifier)) as {
    parseHTML: (html: string) => Record<string, unknown>
  }
  const dom = parseHTML('<!doctype html><html><body></body></html>')
  g.window = dom.window
  g.document = dom.document
  g.DOMParser = dom.DOMParser
  if (typeof g.navigator === 'undefined') g.navigator = {userAgent: 'node'}
}

/**
 * Returns a parser that rejects with mermaid's syntax error for invalid diagrams. The import is
 * done once and shared; call sites pass the result to `assertValidMermaid`.
 */
export function loadMermaidParser(): Promise<MermaidParser> {
  if (!loader) {
    loader = (async () => {
      await installDomShim()
      const specifier = 'mermaid'
      const mod = (await import(/* @vite-ignore */ specifier)) as {
        default: {parse: (text: string) => Promise<unknown>}
      }
      return (source: string) => mod.default.parse(source)
    })()
    loader.catch(() => {
      loader = undefined
    })
  }
  return loader
}
