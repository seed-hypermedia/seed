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
 *   dialect keeps through publishing), and citations in the body become links to those ids
 *   written as `#ref-N`. `write ... fromPath` resolves such fragment links to the published
 *   document's own address. Both common bracket styles are handled: numeric entries (`[3]`,
 *   `3.`) cited as `[3]`, `[1, 2]`, `[4-6]`, and labelled entries (`[Meyrowitz 1986]`,
 *   `[Palay et al. 1988]`) cited by the same label, alone or in a `;`/`,` separated list.
 *
 * Parenthesised author-year citations, `(Meyrowitz, 1986)`, have no bracketed key to match
 * on and are left alone.
 */

const FENCE_RE = /^\s*(```|~~~)/
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*(<!--\s*id:[^>]*-->)?\s*$/
const CAPTION_RE =
  /^\s*(?:\*\*|__)?\s*((?:Figure|Fig\.?|Table|Tab\.?|Chart|Plate|Scheme)\s*[A-Z]?\d+[a-z]?(?:\.\d+)?)\s*[.:：\-–—]?\s*(.*?)\s*(?:\*\*|__)?\s*$/i
const REFERENCES_HEADING_RE =
  /^(#{1,6})\s*(?:\d+[.)]?\s*)?(references?|reference list|bibliography|works cited|literature cited)\s*(<!--.*-->)?\s*$/i
const HEADING_RE = /^(#{1,6})\s/
const NUMERIC_ENTRY_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)?\[?(\d{1,4})[\].]\s+(.*)$/
const LABELLED_ENTRY_RE = /^\s*(?:[-*+]\s+)?\[([^[\]]{1,80})\]\s+\S/
const ID_COMMENT_RE = /<!--\s*id:([A-Za-z0-9_-]+)[^>]*-->/
const BRACKET_RE = /\[([^[\]\n]{1,200})\]/g
const RANGE_RE = /^(\d{1,4})\s*[-–]\s*(\d{1,4})$/
/** A bracket that was meant as a citation even though no entry matched: a number, or a label with a year. */
const LOOKS_CITED_RE = /^\d{1,4}$|\b(?:1[5-9]|20)\d\d[a-z]?\b|\bundated\b|\bn\.d\.?/i

/** What the post-processor changed, for the manifest and the summary. */
export type PostprocessReport = {
  markdown: string
  captionsFolded: number
  referenceEntries: number
  citationsLinked: number
  /** Citation keys (`12`, `Meyrowitz 1999`) with no bibliography entry, left as plain text. */
  citationsUnlinked: string[]
}

/** The lookup key of a citation or entry label: emphasis and spacing differences do not matter. */
function citationKey(label: string): string {
  return label.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The id a bibliography entry carries, by its number or label: `ref-3`, `ref-palay-et-al-1988`. */
export function referenceBlockId(label: string | number): string {
  const slug = citationKey(String(label))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `ref-${slug || 'entry'}`
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

function linkCitations(lines: string[]): {lines: string[]; entries: number; linked: number; unlinked: string[]} {
  const section = referencesSection(lines)
  if (!section) return {lines, entries: 0, linked: 0, unlinked: []}
  // Citation key → block id of the entry.
  const ids = new Map<string, string>()
  const taken = new Set<string>()
  for (let i = section.start + 1; i < section.end; i++) {
    const label = NUMERIC_ENTRY_RE.exec(lines[i]!)?.[2] ?? LABELLED_ENTRY_RE.exec(lines[i]!)?.[1]
    if (!label) continue
    const key = citationKey(label)
    if (ids.has(key)) continue
    const existing = ID_COMMENT_RE.exec(lines[i]!)
    let id = existing ? existing[1]! : referenceBlockId(label)
    for (let n = 2; taken.has(id); n++) id = `${referenceBlockId(label)}-${n}`
    if (!existing) lines[i] = `${lines[i]!.replace(/\s+$/, '')} <!-- id:${id} -->`
    ids.set(key, id)
    taken.add(id)
  }
  if (ids.size === 0) return {lines, entries: 0, linked: 0, unlinked: []}
  let linked = 0
  const unlinked = new Set<string>()
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence || (i >= section.start && i < section.end) || IMAGE_LINE_RE.test(line)) continue
    // Link destinations `](…)` are kept verbatim; a bracketed number inside a URL is not a citation.
    lines[i] = line
      .split(/(\]\([^)]*\))/)
      .map((segment, k) => (k % 2 === 1 ? segment : linkCitationsInText(segment, ids, () => linked++, unlinked)))
      .join('')
  }
  return {lines, entries: ids.size, linked, unlinked: [...unlinked]}
}

function linkCitationsInText(
  text: string,
  ids: Map<string, string>,
  onLink: () => void,
  unlinked: Set<string>,
): string {
  return text.replace(BRACKET_RE, (whole: string, inner: string, offset: number) => {
    // Not a citation when it is a link label or follows one: `[text](url)`, `[a][b]`.
    const before = text[offset - 1]
    const after = text[offset + whole.length]
    if (before === '!' || before === ']' || after === '(' || after === '[' || after === ':') return whole
    // A label that contains the separator itself, `[Smith, 2001]`, is tried whole first.
    const wholeId = ids.get(citationKey(inner))
    if (wholeId) {
      onLink()
      return `[[${inner}](#${wholeId})]`
    }
    // Odd segments are the separators, kept as written.
    const segments = inner.split(/(\s*[;,]\s*)/)
    let changed = false
    const out = segments.map((segment, k) => {
      if (k % 2 === 1) return segment
      const range = RANGE_RE.exec(segment.trim())
      const keys = range ? expandRange(Number(range[1]), Number(range[2])) : [segment.trim()]
      const parts: string[] = []
      for (const key of keys) {
        const id = ids.get(citationKey(key))
        if (id) {
          parts.push(`[${key}](#${id})`)
          onLink()
          changed = true
        } else {
          parts.push(key)
          if (LOOKS_CITED_RE.test(key)) unlinked.add(citationKey(key))
        }
      }
      return parts.join(', ')
    })
    return changed ? `[${out.join('')}]` : whole
  })
}

function expandRange(from: number, to: number): string[] {
  if (to < from || to - from > 50) return []
  return Array.from({length: to - from + 1}, (_, k) => String(from + k))
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
