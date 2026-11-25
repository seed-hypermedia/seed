/**
 * Mermaid diagram validation for Code blocks.
 *
 * A ```mermaid fence publishes as a Code block with `language: "mermaid"`. The viewer renders it
 * with mermaid at read time, so a syntax error written today is only discovered by whoever opens
 * the document. Writers (CLI, agents runtime, SDK users) call {@link assertValidMermaid} before
 * publishing so the error lands on the author instead.
 *
 * This module has no dependency on mermaid itself: the parser is injected, because loading it
 * differs per runtime (a browser has a DOM; Node and Bun need a shim). See `mermaid-parser.ts`
 * for the loader used by the CLI and the agents runtime.
 */

/** Resolves when the source parses; rejects with mermaid's syntax error otherwise. */
export type MermaidParser = (source: string) => Promise<unknown>

export type MermaidDiagramError = {
  blockId: string
  message: string
}

/** The subset of a block node this module reads; both the parser tree and the API shape satisfy it. */
export type MermaidBlockLike = {
  block: {
    id?: string
    type: string
    text?: string
    language?: string
    attributes?: {language?: string} | Record<string, unknown>
  }
  children?: MermaidBlockLike[]
}

export class InvalidMermaidError extends Error {
  readonly errors: MermaidDiagramError[]

  constructor(errors: MermaidDiagramError[]) {
    super(
      `${errors.length === 1 ? 'Invalid mermaid diagram' : `${errors.length} invalid mermaid diagrams`}: ` +
        errors.map((e) => `block ${e.blockId}: ${e.message}`).join('; '),
    )
    this.name = 'InvalidMermaidError'
    this.errors = errors
  }
}

function blockLanguage(block: MermaidBlockLike['block']): string | undefined {
  if (typeof block.language === 'string') return block.language
  const attr = block.attributes && (block.attributes as {language?: unknown}).language
  return typeof attr === 'string' ? attr : undefined
}

/** Every Code block whose language is `mermaid`, in document order, with its source text. */
export function collectMermaidBlocks(nodes: MermaidBlockLike[]): Array<{blockId: string; source: string}> {
  const out: Array<{blockId: string; source: string}> = []
  const walk = (list: MermaidBlockLike[]) => {
    for (const node of list) {
      const {block} = node
      if (block.type === 'Code' && blockLanguage(block)?.trim().toLowerCase() === 'mermaid') {
        out.push({blockId: block.id ?? '', source: block.text ?? ''})
      }
      if (node.children?.length) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** Parses every mermaid block with `parse` and returns the failures (empty when all are valid). */
export async function validateMermaidBlocks(
  nodes: MermaidBlockLike[],
  parse: MermaidParser,
): Promise<MermaidDiagramError[]> {
  const errors: MermaidDiagramError[] = []
  for (const {blockId, source} of collectMermaidBlocks(nodes)) {
    if (!source.trim()) {
      errors.push({blockId, message: 'empty diagram'})
      continue
    }
    try {
      await parse(source)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({blockId, message: message.split('\n').slice(0, 3).join(' ').trim()})
    }
  }
  return errors
}

/** Throws {@link InvalidMermaidError} when any mermaid block in `nodes` fails to parse. */
export async function assertValidMermaid(nodes: MermaidBlockLike[], parse: MermaidParser): Promise<void> {
  const errors = await validateMermaidBlocks(nodes, parse)
  if (errors.length) throw new InvalidMermaidError(errors)
}
