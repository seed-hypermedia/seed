/**
 * Turns the agent's markdown reply into text a TTS engine can read aloud.
 *
 * The Seed session replies in markdown (headings, bullets, links, hm:// URLs, code fences, tables,
 * mermaid diagrams, HTML comments). Spoken verbatim that is noise, so the voice worker runs every
 * reply delta through {@link stripMarkdownForSpeech} before it reaches Cartesia. The rules are
 * deliberately lossy: keep the words, drop the notation.
 *
 * Replies stream in small deltas, and a marker such as `**` or a `[label](url)` link may straddle
 * two deltas. {@link SpeechTextStream} holds back the shortest suffix that could still be the
 * start of such a construct, so the per-delta output equals what stripping the whole reply at
 * once would produce, while everything else is released immediately for low latency.
 */

const URL_RE = /(?:hm|https?|ipfs|ipns):\/\/[^\s<>()]*[^\s<>().,;:!?]/g
/** Placeholder for backslash-escaped punctuation while the marker passes run. */
const ESCAPE_MARK = '\uE000'
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w-]*)[^\n]*$/
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/
const TABLE_ROW_RE = /^\s*\|.*\|?\s*$/
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const HORIZONTAL_RULE_RE = /^\s*([-*_]\s*){3,}$/
const HEADING_RE = /^\s{0,3}#{1,6}\s+/
const BLOCKQUOTE_RE = /^\s*(?:>\s?)+/
const BULLET_RE = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/
const ORDERED_RE = /^\s*\d+[.)]\s+/
const REFERENCE_DEF_RE = /^\s*\[[^\]]+\]:\s+\S+.*$/

export type StripOptions = {
  /**
   * Whether the text begins at the start of a line. When false the first line is not checked for
   * line-level markdown (headings, bullets, table rows), because a mid-line `- ` is just a dash.
   * @default true
   */
  atLineStart?: boolean
  /**
   * Whether to drop whitespace at the very end of the result. Streamed fragments keep it, since
   * the space before the next word may be all a fragment holds.
   * @default true
   */
  trimEnd?: boolean
}

/** Rewrites one markdown line as speech: table rows become comma lists, markers are dropped. */
function stripLine(line: string, lineStart: boolean): string | null {
  let out = line
  if (lineStart) {
    if (HORIZONTAL_RULE_RE.test(out)) return null
    if (REFERENCE_DEF_RE.test(out)) return null
    if (TABLE_ROW_RE.test(out)) {
      if (TABLE_SEPARATOR_RE.test(out)) return null
      const cells = out
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => stripInline(cell).trim())
        .filter((cell) => cell.length > 0)
      return cells.join(', ')
    }
    out = out.replace(HEADING_RE, '')
    out = out.replace(BLOCKQUOTE_RE, '')
    out = out.replace(BULLET_RE, '').replace(ORDERED_RE, '')
  }
  return stripInline(out)
}

/** Drops inline notation: links, URLs, emphasis, code spans, HTML tags, escapes. */
function stripInline(text: string): string {
  // Park backslash-escaped punctuation so the marker passes leave it alone; restored at the end.
  const escaped: string[] = []
  let out = text.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, (_, ch: string) => {
    escaped.push(ch)
    return ESCAPE_MARK
  })
  // Images and links keep their label; reference-style links too.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  out = out.replace(/<((?:hm|https?|ipfs|ipns):\/\/[^>]*)>/g, '$1')
  out = out.replace(URL_RE, 'link')
  // Simple HTML tags (<br>, <b>, </b>, <expr/>) carry nothing to say.
  out = out.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
  out = out.replace(/`+/g, '')
  out = out.replace(/\*\*|__|~~/g, '')
  // Single-character emphasis: an asterisk touching a word; an underscore at a word boundary only,
  // so snake_case identifiers keep their underscores.
  out = out.replace(/\*(?=\S)|(?<=\S)\*/g, '')
  out = out.replace(/(?<![\w])_(?=\S)|(?<=\S)_(?![\w])/g, '')
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out.replaceAll(ESCAPE_MARK, () => escaped.shift() ?? '')
}

/**
 * Strips markdown notation from `text` so it reads naturally when spoken. Fenced code keeps its
 * text; mermaid fences become "(diagram)"; tables become comma-separated rows; links keep their
 * label and bare URLs become the word "link". Leading and trailing whitespace is preserved
 * (except where a whole line disappears) so streamed fragments can be concatenated.
 */
export function stripMarkdownForSpeech(text: string, options: StripOptions = {}): string {
  const atLineStart = options.atLineStart ?? true
  const trimEnd = options.trimEnd ?? true
  const withoutComments = text.replace(HTML_COMMENT_RE, '')
  const lines = withoutComments.split('\n')
  const out: string[] = []
  let fence: {marker: string; mermaid: boolean; hasContent: boolean} | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const lineStart = i > 0 || atLineStart
    if (fence) {
      const close = FENCE_CLOSE_RE.exec(line)
      if (close && close[1]?.[0] === fence.marker[0] && (close[1]?.length ?? 0) >= fence.marker.length) {
        fence = null
        continue
      }
      if (fence.mermaid) {
        if (!fence.hasContent) {
          out.push('(diagram)')
          fence.hasContent = true
        }
        continue
      }
      out.push(line)
      continue
    }
    const open = lineStart ? FENCE_OPEN_RE.exec(line) : null
    if (open) {
      const lang = (open[2] ?? '').toLowerCase()
      fence = {marker: open[1] ?? '```', mermaid: lang === 'mermaid', hasContent: false}
      continue
    }
    const stripped = stripLine(line, lineStart)
    if (stripped === null) continue
    out.push(stripped)
  }
  const joined = out
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  return trimEnd ? joined.replace(/[ \t]+$/, '') : joined
}

/** Characters that can begin an inline marker; a delta ending in them is held for the next one. */
const MARKER_TAIL_RE = /[*_`~[\]()<!\\|#>+-]+$/

/**
 * Streaming wrapper over {@link stripMarkdownForSpeech}: feed reply deltas to {@link push}, speak
 * whatever it returns, and {@link flush} the remainder at the end of the reply.
 */
export class SpeechTextStream {
  #pending = ''
  #atLineStart = true

  /** Adds a delta and returns the text that is safe to speak now (possibly empty). */
  push(delta: string): string {
    this.#pending += delta
    const cut = this.#safeCut(this.#pending)
    if (cut <= 0) return ''
    const raw = this.#pending.slice(0, cut)
    this.#pending = this.#pending.slice(cut)
    return this.#emit(raw)
  }

  /** Releases everything still held back. Call once the reply is complete. */
  flush(): string {
    const raw = this.#pending
    this.#pending = ''
    return raw ? this.#emit(raw) : ''
  }

  #emit(raw: string): string {
    const spoken = stripMarkdownForSpeech(raw, {atLineStart: this.#atLineStart, trimEnd: false})
    this.#atLineStart = raw.endsWith('\n')
    return spoken
  }

  /**
   * Index up to which `text` can be stripped independently of what follows. Complete lines are
   * always safe unless they open a fenced block or a table row (those need the whole construct);
   * the trailing partial line is safe up to any construct that may still be growing.
   */
  #safeCut(text: string): number {
    const lastNewline = text.lastIndexOf('\n')
    let lineStart = this.#atLineStart
    let pos = 0
    // Walk the complete lines: a fence or table row holds everything from its start.
    while (pos <= lastNewline) {
      const end = text.indexOf('\n', pos)
      const line = text.slice(pos, end)
      if (lineStart && (FENCE_OPEN_RE.test(line) || TABLE_ROW_RE.test(line))) {
        if (FENCE_OPEN_RE.test(line)) {
          const closeAt = this.#fenceCloseAfter(text, end + 1, line)
          if (closeAt < 0) return pos
          pos = closeAt
          lineStart = true
          continue
        }
        // A table row is complete once its newline arrived; keep scanning.
      }
      pos = end + 1
      lineStart = true
    }
    const tail = text.slice(pos)
    if (tail.length === 0) return pos
    // The partial line: hold it whole when it could become a line-level construct.
    if (lineStart && (/^[ \t]*(`{1,2}|~{1,2}|`{3,}|~{3,})/.test(tail) || /^\s*\|/.test(tail))) return pos
    if (lineStart && /^[\s#>*+\-\d.)[\]xX]*$/.test(tail) && tail.trim().length > 0 && tail.length < 8) return pos
    // Trailing marker characters go first: the constructs below are then checked on what remains,
    // so a link whose closing paren was just held back still counts as unclosed and is held whole.
    let cut = tail.length
    const markerTail = MARKER_TAIL_RE.exec(tail)
    if (markerTail) cut = markerTail.index
    const head = tail.slice(0, cut)
    const comment = head.lastIndexOf('<!--')
    if (comment >= 0 && head.indexOf('-->', comment) < 0) cut = Math.min(cut, comment)
    const openLink = this.#unclosedLinkStart(head)
    if (openLink >= 0) cut = Math.min(cut, openLink)
    const urlStart = this.#openUrlStart(head)
    if (urlStart >= 0) cut = Math.min(cut, urlStart)
    return pos + Math.max(0, cut)
  }

  /** Offset just past the line closing the fence opened by `openLine`, or -1 when unterminated. */
  #fenceCloseAfter(text: string, from: number, openLine: string): number {
    const marker = FENCE_OPEN_RE.exec(openLine)?.[1] ?? '```'
    let pos = from
    while (pos <= text.length) {
      const end = text.indexOf('\n', pos)
      if (end < 0) return -1
      const line = text.slice(pos, end)
      const close = FENCE_CLOSE_RE.exec(line)
      if (close && close[1]?.[0] === marker[0] && (close[1]?.length ?? 0) >= marker.length) return end + 1
      pos = end + 1
    }
    return -1
  }

  /** Start of a `[label](url)` that has not finished yet, or -1. Gives up after 300 chars. */
  #unclosedLinkStart(tail: string): number {
    const open = tail.lastIndexOf('[')
    if (open < 0) return -1
    const rest = tail.slice(open)
    if (rest.length > 300) return -1
    const close = rest.indexOf(']')
    if (close < 0) return open
    const after = rest.slice(close + 1)
    if (after.startsWith('(') && after.indexOf(')') < 0) return open
    if (after.length === 0) return open
    return -1
  }

  /** Start of a URL token still being streamed (no whitespace after it yet), or -1. */
  #openUrlStart(tail: string): number {
    const lastSpace = Math.max(tail.lastIndexOf(' '), tail.lastIndexOf('\t'))
    const token = tail.slice(lastSpace + 1)
    const stripped = token.replace(/^[(<[]+/, '')
    if (
      /^(?:hm|https?|ipfs|ipns):\/\//.test(stripped) ||
      /^(?:h|hm|ht|htt|http|https|i|ip|ipf|ipfs|ipn|ipns)(?::\/?\/?)?$/.test(stripped)
    ) {
      return lastSpace + 1
    }
    return -1
  }
}
