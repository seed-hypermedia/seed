declare module 'marked-terminal' {
  import type {MarkedExtension} from 'marked'

  /** A chalk-like function: `(text: string) => string`. */
  type StyleFn = (text: string) => string

  interface MarkedTerminalOptions {
    /** Style for first heading (h1). */
    firstHeading?: StyleFn
    /** Style for headings (h2+). */
    heading?: StyleFn
    /** Style for strong/bold text. */
    strong?: StyleFn
    /** Style for emphasized/italic text. */
    em?: StyleFn
    /** Style for inline code. */
    codespan?: StyleFn
    /** Style for code blocks. */
    code?: StyleFn
    /** Style for blockquotes. */
    blockquote?: StyleFn
    /** Style for link text. */
    link?: StyleFn
    /** Style for link URLs. */
    href?: StyleFn
    /** Style for HTML content. */
    html?: StyleFn
    /** Style for horizontal rules. */
    hr?: StyleFn
    /** Style for list items. */
    listitem?: StyleFn
    /** Style for tables. */
    table?: StyleFn
    /** Style for paragraphs. */
    paragraph?: StyleFn
    /** Style for strikethrough text. */
    del?: StyleFn
    /** Whether to prefix headings with section markers. */
    showSectionPrefix?: boolean
    /** Whether to reflow text to fit width. */
    reflowText?: boolean
    /** Output width when reflowText is true. */
    width?: number
    /** Whether to unescape HTML entities. */
    unescape?: boolean
    /** Whether to render emoji shortcodes. */
    emoji?: boolean
    /** Tab size in spaces or tab characters. */
    tab?: number | string
    /** Options passed to cli-table3. */
    tableOptions?: Record<string, unknown>
    /** Custom image rendering function. */
    image?: (href: string, title: string, text: string) => string
  }

  /** Create a marked extension that renders markdown as ANSI-styled terminal output. */
  export function markedTerminal(options?: MarkedTerminalOptions): MarkedExtension
}
