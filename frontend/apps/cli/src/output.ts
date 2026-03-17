/**
 * Output formatting utilities
 *
 * `--pretty` is a boolean modifier that beautifies whatever the current
 * output format is:
 *   --pretty (+ json default) -> colorized JSON (jq-style)
 *   --pretty --yaml           -> colorized YAML
 *   --pretty on markdown      -> ANSI-rendered markdown (bold, headings, lists, etc.)
 */

import chalk from 'chalk'
import {Marked} from 'marked'
import {markedTerminal} from 'marked-terminal'
import YAML from 'yaml'

export type OutputFormat = 'json' | 'yaml' | 'table'

export function formatOutput(data: unknown, format: OutputFormat = 'json', pretty = false): string {
  switch (format) {
    case 'json':
      return pretty ? colorizeJson(data) : JSON.stringify(data, replacer, 2)
    case 'yaml':
      return pretty ? colorizeYaml(data) : YAML.stringify(data, {indent: 2})
    case 'table':
      return formatTable(data)
    default:
      return pretty ? colorizeJson(data) : JSON.stringify(data, replacer, 2)
  }
}

// JSON replacer to handle BigInt
export function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

// ── Colorized JSON (jq-style) ────────────────────────────────────────────────

export function colorizeJson(data: unknown): string {
  const json = JSON.stringify(data, replacer, 2)
  if (!json) return chalk.dim('null')
  return colorizeJsonString(json)
}

/**
 * Apply jq-style syntax highlighting to a pre-formatted JSON string.
 * Keys are blue/bold, strings green, numbers yellow, booleans blue, null dim.
 */
function colorizeJsonString(json: string): string {
  return json.replace(
    // Match JSON tokens: keys (quoted strings before colon), string values,
    // numbers, booleans, and null.
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false)|(null)/g,
    (match, key, str, num, bool, nul) => {
      if (key) return chalk.blue(key) + ':'
      if (str) return chalk.green(str)
      if (num) return chalk.yellow(num)
      if (bool) return chalk.blue(bool)
      if (nul) return chalk.dim(nul)
      return match
    },
  )
}

// ── Colorized YAML ───────────────────────────────────────────────────────────

export function colorizeYaml(data: unknown): string {
  const yaml = YAML.stringify(data, {indent: 2})
  return colorizeYamlString(yaml)
}

/**
 * Apply syntax highlighting to a YAML string.
 * Keys are cyan, strings green, numbers yellow, booleans blue, null dim.
 */
function colorizeYamlString(yaml: string): string {
  return yaml
    .split('\n')
    .map((line) => {
      // Comment lines
      if (line.trimStart().startsWith('#')) return chalk.dim(line)

      // Lines with key: value
      const kvMatch = line.match(/^(\s*)([\w./-]+)(\s*:\s*)(.*)$/)
      if (kvMatch) {
        const [, indent, key, sep, value] = kvMatch
        return indent + chalk.cyan(key) + sep + colorizeYamlValue(value)
      }

      // List items (- value)
      const listMatch = line.match(/^(\s*-\s+)(.*)$/)
      if (listMatch) {
        const [, prefix, value] = listMatch
        return prefix + colorizeYamlValue(value)
      }

      return line
    })
    .join('\n')
}

function colorizeYamlValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return chalk.dim(trimmed)
  if (trimmed === 'true' || trimmed === 'false') return chalk.blue(trimmed)
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) return chalk.yellow(trimmed)
  // Quoted strings
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return chalk.green(trimmed)
  }
  // Unquoted string value
  if (trimmed.length > 0 && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return chalk.green(trimmed)
  }
  return value
}

// ── Block-ID stripping for pretty markdown ───────────────────────────────────

/**
 * Remove `<!-- id:... -->` HTML comments injected by blocksToMarkdown().
 * Handles two patterns:
 *   1. Inline:     `text <!-- id:abc123 -->` -> `text`
 *   2. Standalone: `<!-- id:abc123 -->` on its own line -> removed
 * Collapses resulting double-blank-lines.
 */
export function stripBlockIdComments(markdown: string): string {
  return (
    markdown
      // Remove inline block-id comments (with leading space)
      .replace(/ <!-- id:[a-zA-Z0-9_-]+ -->/g, '')
      // Remove standalone block-id comment lines
      .replace(/^<!-- id:[a-zA-Z0-9_-]+ -->$/gm, '')
      // Collapse runs of 3+ newlines into 2 (one blank line)
      .replace(/\n{3,}/g, '\n\n')
  )
}

// ── Terminal markdown rendering ──────────────────────────────────────────────

/** Lazily-initialized Marked instance configured for terminal rendering. */
let terminalMarked: Marked | undefined

/** Get or create a Marked instance with the terminal renderer. */
function getTerminalMarked(): Marked {
  if (!terminalMarked) {
    terminalMarked = new Marked(
      markedTerminal({
        firstHeading: chalk.magenta.underline.bold,
        heading: chalk.green.bold,
        strong: chalk.bold,
        em: chalk.italic,
        codespan: chalk.yellow,
        code: chalk.yellow,
        blockquote: chalk.gray.italic,
        link: chalk.blue,
        href: chalk.blue.underline,
        showSectionPrefix: false,
        reflowText: false,
        tab: 2,
        unescape: true,
        emoji: true,
      }),
    )
  }
  return terminalMarked
}

/**
 * Render a markdown string as ANSI-styled terminal output.
 *
 * Handles YAML frontmatter (between `---` delimiters) separately:
 * frontmatter is rendered as colorized YAML, while the body is
 * parsed through marked-terminal for full ANSI styling (bold headings,
 * italic text, formatted lists, syntax-highlighted code blocks, etc.).
 */
export function renderMarkdown(markdown: string): string {
  const clean = stripBlockIdComments(markdown)
  const {frontmatter, body} = splitFrontmatter(clean)

  const parts: string[] = []
  if (frontmatter) {
    parts.push(colorizeYamlString(frontmatter))
  }
  if (body) {
    const rendered = getTerminalMarked().parse(body) as string
    parts.push(fixInlineFormatting(rendered).trimEnd())
  }
  return parts.join('\n')
}

/**
 * Fix inline formatting that marked-terminal drops inside list items.
 *
 * marked-terminal correctly renders bold/italic in paragraphs and blockquotes
 * but passes raw `**`/`*` through in list items. This post-processes the
 * rendered output to apply ANSI styles to any leftover markdown markers.
 *
 * Order matters: bold+italic (`***`) before bold (`**`) before italic (`*`).
 */
function fixInlineFormatting(rendered: string): string {
  return (
    rendered
      // ***bold italic*** or ___bold italic___
      .replace(/\*{3}(.+?)\*{3}/g, (_, t) => chalk.bold.italic(t))
      // **bold**
      .replace(/\*{2}(.+?)\*{2}/g, (_, t) => chalk.bold(t))
      // *italic* — but not the `* ` list bullet prefix
      .replace(/(?<!\*)\*(?!\s|\*)(.+?)(?<!\s)\*(?!\*)/g, (_, t) => chalk.italic(t))
      // ~~strikethrough~~
      .replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t))
  )
}

/**
 * Split YAML frontmatter from the markdown body.
 * Frontmatter is the content between opening `---` and closing `---`
 * at the start of the document.
 */
function splitFrontmatter(markdown: string): {frontmatter: string; body: string} {
  const trimmed = markdown.trimStart()
  if (!trimmed.startsWith('---')) {
    return {frontmatter: '', body: markdown}
  }

  // Find the closing `---` delimiter (skip the opening one)
  const afterOpening = trimmed.indexOf('\n')
  if (afterOpening === -1) {
    return {frontmatter: '', body: markdown}
  }

  const closingIdx = trimmed.indexOf('\n---', afterOpening)
  if (closingIdx === -1) {
    return {frontmatter: '', body: markdown}
  }

  // Extract frontmatter (between the delimiters, without the --- lines)
  const frontmatter = trimmed.slice(afterOpening + 1, closingIdx).trim()
  // Body starts after the closing --- and its newline
  const bodyStart = closingIdx + 4 // '\n---'.length
  const body = trimmed.slice(bodyStart).trim()

  return {frontmatter, body}
}

// ── Table formatting ─────────────────────────────────────────────────────────

function formatTable(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)'

    const first = data[0]
    if (typeof first !== 'object' || first === null) {
      return data.map(String).join('\n')
    }

    const keys = Object.keys(first)
    const widths = keys.map((k) => Math.max(k.length, ...data.map((row) => String(row[k] ?? '').length)))

    const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ')
    const separator = widths.map((w) => '-'.repeat(w)).join('  ')
    const rows = data.map((row) => keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  '))

    return [header, separator, ...rows].join('\n')
  }

  if (typeof data === 'object' && data !== null) {
    return Object.entries(data)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join('\n')
  }

  return String(data)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.length} items]`
    }
    return '{...}'
  }
  return String(value)
}

// ── CLI message helpers ──────────────────────────────────────────────────────

export function printSuccess(message: string) {
  console.error(chalk.green('✓'), message)
}

export function printError(message: string) {
  console.error(chalk.red('✗'), message)
}

export function printWarning(message: string) {
  console.error(chalk.yellow('⚠'), message)
}

export function printInfo(message: string) {
  console.error(chalk.blue('ℹ'), message)
}
