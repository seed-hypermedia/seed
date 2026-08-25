/**
 * A small markdown renderer for React Native.
 *
 * Agent replies arrive as markdown and stream in token by token, so this runs on every delta of
 * every message. The web UI uses react-markdown, which is DOM-only; rather than pull a heavyweight
 * RN markdown package for prose that is overwhelmingly paragraphs, lists, code and links, this
 * parses the block grammar the model actually emits and renders it with the app's own tokens.
 *
 * It is deliberately forgiving about incomplete input: a half-streamed fenced block or an unclosed
 * `**` is normal mid-stream, so unterminated constructs render as their literal text and resolve
 * themselves on the next delta rather than flickering.
 */

import React, {useMemo} from 'react'
import {Linking, StyleSheet, Text, View, type StyleProp, type TextStyle} from 'react-native'
import {radius, theme} from '../../theme'

// ─── Block parsing ───────────────────────────────────────────────────────────

type MdBlock =
  | {kind: 'paragraph'; text: string}
  | {kind: 'heading'; level: number; text: string}
  | {kind: 'listItem'; text: string; ordered: boolean; marker: string; depth: number}
  | {kind: 'code'; text: string; language?: string}
  | {kind: 'quote'; text: string}
  | {kind: 'rule'}

const HEADING = /^(#{1,6})\s+(.*)$/
const UNORDERED = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s*(?:---+|\*\*\*+|___+)\s*$/
const FENCE = /^\s*```(.*)$/

/** Splits markdown source into the block types this renderer draws. */
export function parseMarkdownBlocks(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let paragraph: string[] = []
  let quote: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({kind: 'paragraph', text: paragraph.join('\n').trim()})
      paragraph = []
    }
  }
  const flushQuote = () => {
    if (quote.length) {
      blocks.push({kind: 'quote', text: quote.join('\n').trim()})
      quote = []
    }
  }
  const flushAll = () => {
    flushParagraph()
    flushQuote()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = FENCE.exec(line)
    if (fence) {
      flushAll()
      const language = fence[1].trim() || undefined
      const body: string[] = []
      i++
      // An unterminated fence is the normal mid-stream state: consume to the end and render what
      // has arrived so far rather than dropping the block until the closing ``` shows up.
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      blocks.push({kind: 'code', text: body.join('\n'), language})
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    if (RULE.test(line)) {
      flushAll()
      blocks.push({kind: 'rule'})
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushAll()
      blocks.push({kind: 'heading', level: heading[1].length, text: heading[2].trim()})
      continue
    }

    const quoted = QUOTE.exec(line)
    if (quoted) {
      flushParagraph()
      quote.push(quoted[1])
      continue
    }
    flushQuote()

    const ordered = ORDERED.exec(line)
    if (ordered) {
      flushParagraph()
      blocks.push({
        kind: 'listItem',
        text: ordered[3],
        ordered: true,
        marker: `${ordered[2]}.`,
        depth: Math.floor(ordered[1].length / 2),
      })
      continue
    }

    const unordered = UNORDERED.exec(line)
    if (unordered) {
      flushParagraph()
      blocks.push({
        kind: 'listItem',
        text: unordered[2],
        ordered: false,
        marker: '•',
        depth: Math.floor(unordered[1].length / 2),
      })
      continue
    }

    paragraph.push(line)
  }

  flushAll()
  return blocks
}

// ─── Inline parsing ──────────────────────────────────────────────────────────

type MdInline =
  | {kind: 'text'; text: string}
  | {kind: 'code'; text: string}
  | {kind: 'strong'; text: string}
  | {kind: 'em'; text: string}
  | {kind: 'link'; text: string; href: string}

// Ordered by precedence: code spans win over emphasis so `**` inside backticks stays literal.
const INLINE = /(`[^`]+`)|(\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/

const WORD_CHAR = /[A-Za-z0-9]/

/** Appends text, merging into the previous run so literal fragments don't fragment the output. */
function pushText(out: MdInline[], text: string): void {
  if (!text) return
  const last = out[out.length - 1]
  if (last?.kind === 'text') last.text += text
  else out.push({kind: 'text', text})
}

/** Splits one line of markdown into inline runs. Unterminated markers stay literal text. */
export function parseMarkdownInline(source: string): MdInline[] {
  const out: MdInline[] = []
  let rest = source
  // The character immediately before `rest` in the original source, for the underscore boundary
  // rule below. Start-of-string counts as a boundary.
  let prevChar = ''

  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (!match || match.index === undefined) break

    const token = match[0]
    const before = match.index > 0 ? rest[match.index - 1] : prevChar
    const after = rest[match.index + token.length] ?? ''

    // CommonMark: underscores do not create emphasis inside a word, precisely so that
    // snake_case survives. Agent prose is full of tool and file names — `read_agent_memory`
    // must not render as "read *agent* memory".
    if (token.startsWith('_') && (WORD_CHAR.test(before) || WORD_CHAR.test(after))) {
      const literalEnd = match.index + 1
      pushText(out, rest.slice(0, literalEnd))
      prevChar = rest[literalEnd - 1]
      rest = rest.slice(literalEnd)
      continue
    }

    pushText(out, rest.slice(0, match.index))

    if (token.startsWith('`')) {
      out.push({kind: 'code', text: token.slice(1, -1)})
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      out.push({kind: 'link', text: token.slice(1, split), href: token.slice(split + 2, -1)})
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push({kind: 'strong', text: token.slice(2, -2)})
    } else {
      out.push({kind: 'em', text: token.slice(1, -1)})
    }

    prevChar = token[token.length - 1]
    rest = rest.slice(match.index + token.length)
  }

  pushText(out, rest)
  return out
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function InlineText({
  source,
  style,
  onOpenUrl,
}: {
  source: string
  style?: StyleProp<TextStyle>
  onOpenUrl?: (url: string) => void
}) {
  const parts = useMemo(() => parseMarkdownInline(source), [source])
  return (
    <Text style={[styles.body, style]}>
      {parts.map((part, index) => {
        switch (part.kind) {
          case 'code':
            return (
              <Text key={index} style={styles.inlineCode}>
                {part.text}
              </Text>
            )
          case 'strong':
            return (
              <Text key={index} style={styles.strong}>
                {part.text}
              </Text>
            )
          case 'em':
            return (
              <Text key={index} style={styles.em}>
                {part.text}
              </Text>
            )
          case 'link':
            return (
              <Text
                key={index}
                style={styles.link}
                onPress={() => (onOpenUrl ? onOpenUrl(part.href) : Linking.openURL(part.href).catch(() => {}))}
              >
                {part.text || part.href}
              </Text>
            )
          default:
            return <Text key={index}>{part.text}</Text>
        }
      })}
    </Text>
  )
}

const HEADING_SIZE: Record<number, TextStyle> = {
  1: {fontSize: 20, lineHeight: 26},
  2: {fontSize: 18, lineHeight: 24},
  3: {fontSize: 16, lineHeight: 22},
  4: {fontSize: 15, lineHeight: 21},
  5: {fontSize: 14, lineHeight: 20},
  6: {fontSize: 13, lineHeight: 19},
}

export function Markdown({
  children,
  style,
  onOpenUrl,
}: {
  children: string
  /** Applied to body text; used to tint prose inside a colored bubble. */
  style?: StyleProp<TextStyle>
  onOpenUrl?: (url: string) => void
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(children), [children])

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <InlineText
                key={index}
                source={block.text}
                style={[styles.heading, HEADING_SIZE[block.level] ?? HEADING_SIZE[6], style]}
                onOpenUrl={onOpenUrl}
              />
            )
          case 'code':
            return (
              <View key={index} style={styles.codeBlock}>
                {block.language ? <Text style={styles.codeLanguage}>{block.language}</Text> : null}
                <Text style={styles.codeText}>{block.text}</Text>
              </View>
            )
          case 'quote':
            return (
              <View key={index} style={styles.quote}>
                <InlineText source={block.text} style={[styles.quoteText, style]} onOpenUrl={onOpenUrl} />
              </View>
            )
          case 'listItem':
            return (
              <View key={index} style={[styles.listItem, {paddingLeft: 4 + block.depth * 16}]}>
                <Text style={[styles.listMarker, style]}>{block.marker}</Text>
                <InlineText source={block.text} style={[styles.listText, style]} onOpenUrl={onOpenUrl} />
              </View>
            )
          case 'rule':
            return <View key={index} style={styles.rule} />
          default:
            return <InlineText key={index} source={block.text} style={style} onOpenUrl={onOpenUrl} />
        }
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {gap: 8},
  body: {color: theme.foreground, fontSize: 15, lineHeight: 21},
  heading: {color: theme.foreground, fontWeight: '700'},
  strong: {fontWeight: '700'},
  em: {fontStyle: 'italic'},
  link: {color: theme.brand, textDecorationLine: 'underline'},
  inlineCode: {
    fontFamily: 'Menlo',
    fontSize: 13,
    color: theme.brand,
  },
  codeBlock: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    padding: 10,
    gap: 4,
  },
  codeLanguage: {color: theme.mutedForeground, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6},
  codeText: {fontFamily: 'Menlo', fontSize: 12, lineHeight: 17, color: theme.foreground},
  quote: {borderLeftWidth: 3, borderLeftColor: theme.border, paddingLeft: 10},
  quoteText: {color: theme.mutedForeground, fontStyle: 'italic'},
  listItem: {flexDirection: 'row', gap: 8, alignItems: 'flex-start'},
  listMarker: {color: theme.mutedForeground, fontSize: 15, lineHeight: 21, minWidth: 16},
  listText: {flex: 1},
  rule: {height: 1, backgroundColor: theme.border, marginVertical: 4},
})
