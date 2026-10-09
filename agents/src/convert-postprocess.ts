/**
 * Deterministic clean-up of converted markdown before an agent reviews it.
 *
 * Datalab returns a faithful but flat document: figure captions sit in their own paragraph next
 * to the image, and citations are plain `[3]` text with no way to reach the bibliography entry.
 * The import guide asks for both to be fixed, and both are mechanical, so `convert` does them
 * here instead of spending model turns on them:
 *
 * - A `Figure N: …` (or `Fig.`, `Table`) paragraph adjacent to a standalone image becomes that
 *   image's caption, the alt text of the image line, and the paragraph goes away.
 * - Entries of the references section get block ids (`<!-- id:ref-N -->`, which the markdown
 *   dialect keeps through publishing), and numeric citations in the body, `[3]`, `[1, 2]`,
 *   `[4-6]`, become links to those ids written as `#ref-N`. `write ... fromPath` resolves such
 *   fragment links to the published document's own address.
 *
 * Author-year citations are left alone and reported, so the agent can link what it can verify.
 */

const FENCE_RE = /^\s*(```|~~~)/
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*(<!--\s*id:[^>]*-->)?\s*$/
const CAPTION_RE =
  /^\s*(?:\*\*|__)?\s*((?:Figure|Fig\.?|Table|Tab\.?|Chart|Plate|Scheme)\s*[A-Z]?\d+[a-z]?(?:\.\d+)?)\s*[.:：\-–—]?\s*(.*?)\s*(?:\*\*|__)?\s*$/i
const REFERENCES_HEADING_RE =
  /^(#{1,6})\s*(?:\d+[.)]?\s*)?(references?|reference list|bibliography|works cited|literature cited)\s*(<!--.*-->)?\s*$/i
const HEADING_RE = /^(#{1,6})\s/
const ENTRY_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)?\[?(\d{1,4})[\].]\s+(.*)$/
const ID_COMMENT_RE = /<!--\s*id:([A-Za-z0-9_-]+)[^>]*-->/
const CITATION_RE = /\[(\d{1,4}(?:\s*[-–]\s*\d{1,4})?(?:\s*,\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?)*)\]/g

/** What the post-processor changed, for the manifest and the summary. */
export type PostprocessReport = {
  markdown: string
  captionsFolded: number
  referenceEntries: number
  citationsLinked: number
  /** Citation numbers with no bibliography entry, left as plain text. */
  citationsUnlinked: number[]
}

/** The id a bibliography entry carries, by its number. */
export function referenceBlockId(n: number): string {
  return `ref-${n}`
}

function stripEmphasis(text: string): string {
  return text
    .replace(/^(\*\*|__)\s*/, '')
    .replace(/\s*(\*\*|__)$/, '')
    .trim()
}

/** True when the image's alt is empty or just the label (`Figure 3`), so the full caption should replace it. */
function altWantsCaption(alt: string, label: string): boolean {
  const a = alt.trim().toLowerCase().replace(/\s+/g, ' ')
  const l = label.trim().toLowerCase().replace(/\s+/g, ' ')
  return a === '' || a === l || a === l.replace(/[.:]$/, '')
}

function foldCaptions(lines: string[]): {lines: string[]; folded: number} {
  const out: string[] = []
  const drop = new Set<number>()
  let folded = 0
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence) continue
    const image = IMAGE_LINE_RE.exec(line)
    if (!image) continue
    // The caption is the nearest non-blank line after the image (Datalab's usual order), else before.
    for (const dir of [1, -1]) {
      let j = i + dir
      while (j >= 0 && j < lines.length && lines[j]!.trim() === '') j += dir
      if (j < 0 || j >= lines.length || drop.has(j) || IMAGE_LINE_RE.test(lines[j]!) || HEADING_RE.test(lines[j]!))
        continue
      const caption = CAPTION_RE.exec(lines[j]!)
      if (!caption) continue
      const label = caption[1]!
      const text = stripEmphasis(caption[2] ?? '')
      if (!altWantsCaption(image[1] ?? '', label)) continue
      const full = text ? `${label.replace(/[.:]$/, '')}: ${text}` : label
      lines[i] = line.replace(
        IMAGE_LINE_RE,
        (_m, _alt, url: string, id?: string) => `![${full}](${url})${id ? ` ${id}` : ''}`,
      )
      drop.add(j)
      // The blank line that separated the caption from its neighbour goes with it.
      if (lines[j + 1]?.trim() === '') drop.add(j + 1)
      else if (lines[j - 1]?.trim() === '') drop.add(j - 1)
      folded++
      break
    }
  }
  for (let i = 0; i < lines.length; i++) if (!drop.has(i)) out.push(lines[i]!)
  return {lines: out, folded}
}

/** Finds the references section: the heading line index and where the section ends (exclusive). */
function referencesSection(lines: string[]): {start: number; end: number} | undefined {
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i]!)) inFence = !inFence
    if (inFence) continue
    const heading = REFERENCES_HEADING_RE.exec(lines[i]!)
    if (!heading) continue
    const level = heading[1]!.length
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const next = HEADING_RE.exec(lines[j]!)
      if (next && next[1]!.length <= level) {
        end = j
        break
      }
    }
    return {start: i, end}
  }
  return undefined
}

function linkCitations(lines: string[]): {lines: string[]; entries: number; linked: number; unlinked: number[]} {
  const section = referencesSection(lines)
  if (!section) return {lines, entries: 0, linked: 0, unlinked: []}
  const ids = new Map<number, string>()
  for (let i = section.start + 1; i < section.end; i++) {
    const entry = ENTRY_RE.exec(lines[i]!)
    if (!entry) continue
    const n = Number(entry[2])
    if (ids.has(n)) continue
    const existing = ID_COMMENT_RE.exec(lines[i]!)
    const id = existing ? existing[1]! : referenceBlockId(n)
    if (!existing) lines[i] = `${lines[i]!.replace(/\s+$/, '')} <!-- id:${id} -->`
    ids.set(n, id)
  }
  if (ids.size === 0) return {lines, entries: 0, linked: 0, unlinked: []}
  let linked = 0
  const unlinked = new Set<number>()
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence || (i >= section.start && i < section.end) || IMAGE_LINE_RE.test(line)) continue
    // Link destinations `](…)` are kept verbatim; a bracketed number inside a URL is not a citation.
    lines[i] = line
      .split(/(\]\([^)]*\))/)
      .map((segment, k) => (k % 2 === 1 ? segment : linkCitationsInText(segment, ids, (n) => linked++, unlinked)))
      .join('')
  }
  return {lines, entries: ids.size, linked, unlinked: [...unlinked].sort((a, b) => a - b)}
}

function linkCitationsInText(
  text: string,
  ids: Map<number, string>,
  onLink: (n: number) => void,
  unlinked: Set<number>,
): string {
  return text.replace(CITATION_RE, (whole: string, inner: string, offset: number) => {
    // Not a citation when it is a link label or follows one: `[text](url)`, `[a][b]`.
    const before = text[offset - 1]
    const after = text[offset + whole.length]
    if (before === '!' || before === ']' || after === '(' || after === '[' || after === ':') return whole
    const parts: string[] = []
    let changed = false
    for (const piece of inner.split(',')) {
      const range = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(piece)
      const numbers = range ? expandRange(Number(range[1]), Number(range[2])) : [Number(piece.trim())]
      if (!numbers.length) return whole
      for (const n of numbers) {
        const id = ids.get(n)
        if (id) {
          parts.push(`[${n}](#${id})`)
          onLink(n)
          changed = true
        } else {
          parts.push(String(n))
          unlinked.add(n)
        }
      }
    }
    return changed ? `[${parts.join(', ')}]` : whole
  })
}

function expandRange(from: number, to: number): number[] {
  if (to < from || to - from > 50) return []
  return Array.from({length: to - from + 1}, (_, k) => from + k)
}

/** Runs every clean-up step over converted markdown. Fenced code is never touched. */
export function postprocessConvertedMarkdown(markdown: string): PostprocessReport {
  const captions = foldCaptions(markdown.split('\n'))
  const citations = linkCitations(captions.lines)
  return {
    markdown: citations.lines.join('\n'),
    captionsFolded: captions.folded,
    referenceEntries: citations.entries,
    citationsLinked: citations.linked,
    citationsUnlinked: citations.unlinked,
  }
}
