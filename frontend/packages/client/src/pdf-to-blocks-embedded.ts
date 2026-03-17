/**
 * Embedded PDF-to-HMBlockNode converter using pdfjs-dist.
 *
 * Extracts text from PDFs using Mozilla's PDF.js and converts to Seed
 * Hypermedia blocks via font-size clustering and heuristic detection.
 *
 * This is the fallback path when no GROBID server is available.
 * Requires `pdfjs-dist` to be installed (optional peer dependency).
 */

import type {HMAnnotation, HMBlockNode, HMMetadata} from './hm-types'

// ── pdfjs-dist types (local, to avoid hard dependency) ───────────────────────

interface TextItem {
  str: string
  dir: string
  transform: number[] // [scaleX, skewX, skewY, scaleY, translateX, translateY]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}

interface TextMarkedContent {
  type: 'beginMarkedContent' | 'endMarkedContent'
  tag?: string
}

type PageItem = TextItem | TextMarkedContent

interface TextStyle {
  fontFamily?: string
  ascent?: number
  descent?: number
  vertical?: boolean
}

interface FontObject {
  name?: string
  type?: string
  bold?: boolean
  italic?: boolean
  black?: boolean
  isMonospace?: boolean
}

interface PdfPage {
  getTextContent: (params?: {
    includeMarkedContent?: boolean
  }) => Promise<{items: PageItem[]; styles: Record<string, TextStyle>}>
  getOperatorList: () => Promise<unknown>
  getViewport: (params: {scale: number}) => {width: number; height: number}
  commonObjs: {
    get: (name: string) => FontObject | undefined
    has: (name: string) => boolean
  }
}

interface PdfDocument {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPage>
}

// ── Result type ──────────────────────────────────────────────────────────────

export type EmbeddedPdfResult = {
  metadata: Pick<HMMetadata, 'name'>
  blocks: HMBlockNode[]
}

// ── Internal representation ──────────────────────────────────────────────────

interface TextRun {
  text: string
  fontSize: number
  fontName: string
  x: number
  y: number
  width: number
  bold: boolean
  italic: boolean
  monospace: boolean
}

interface TextLine {
  runs: TextRun[]
  y: number
  x: number
  fontSize: number
  fontName: string
  bold: boolean
  italic: boolean
  monospace: boolean
  pageIndex: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateBlockId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function isTextItem(item: PageItem): item is TextItem {
  return 'str' in item
}

function isBoldFont(fontName: string): boolean {
  const lower = fontName.toLowerCase()
  return lower.includes('bold') || lower.includes('heavy') || lower.includes('black')
}

function isItalicFont(fontName: string): boolean {
  const lower = fontName.toLowerCase()
  return lower.includes('italic') || lower.includes('oblique') || lower.includes('slant')
}

function isMonospaceFont(fontName: string): boolean {
  const lower = fontName.toLowerCase()
  return (
    lower.includes('mono') ||
    lower.includes('courier') ||
    lower.includes('consolas') ||
    lower.includes('menlo') ||
    lower.includes('firacode') ||
    lower.includes('inconsolata') ||
    lower.includes('source code') ||
    lower.includes('dejavu sans mono') ||
    lower.includes('lucida console')
  )
}

// ── HM block constructors ────────────────────────────────────────────────────

function makeBlock(type: string, text: string, extra: Record<string, unknown> = {}): HMBlockNode {
  return {
    block: {
      id: generateBlockId(),
      type,
      text,
      revision: '',
      link: '',
      attributes: {},
      annotations: [],
      ...extra,
    } as HMBlockNode['block'],
    children: [],
  }
}

function makeHeading(text: string, annotations: HMAnnotation[] = []): HMBlockNode {
  return makeBlock('Heading', text, {
    attributes: {childrenType: 'Group' as const},
    annotations,
  })
}

function makeParagraph(text: string, annotations: HMAnnotation[] = []): HMBlockNode {
  return makeBlock('Paragraph', text, {annotations})
}

function makeCode(text: string, language = ''): HMBlockNode {
  return makeBlock('Code', text, {
    attributes: language ? {language} : {},
  })
}

function makeList(items: HMBlockNode[], listType: 'Ordered' | 'Unordered'): HMBlockNode {
  const container = makeBlock('Paragraph', '', {
    attributes: {childrenType: listType},
  })
  container.children = items
  return container
}

// ── Font size clustering for heading detection ───────────────────────────────

/** Minimum trimmed text length for a line to count toward heading-size candidates. */
const MIN_HEADING_TEXT_LENGTH = 4

function clusterFontSizes(lines: TextLine[]): {
  bodySize: number
  headingLevels: Map<number, number> // fontSize -> heading level (1,2,3,…)
  boldHeadingLevel: number // heading level to assign to bold-at-body-size lines
} {
  const sizeCount = new Map<number, number>()

  for (const line of lines) {
    if (line.runs.length === 0) continue
    const size = Math.round(line.fontSize * 10) / 10
    sizeCount.set(size, (sizeCount.get(size) || 0) + 1)
  }

  if (sizeCount.size === 0) {
    return {bodySize: 12, headingLevels: new Map(), boldHeadingLevel: 1}
  }

  // Most common size is body text
  const clusters = Array.from(sizeCount.entries())
    .map(([size, count]) => ({size, count}))
    .sort((a, b) => b.count - a.count)

  const bodySize = clusters[0]!.size

  // Build heading candidates from lines with enough text to be real headings.
  // This filters noise from math symbols, diagram fragments, and other short
  // runs that appear at unusual font sizes and would otherwise consume the
  // limited heading-level slots.
  const headingSizeCount = new Map<number, number>()
  for (const line of lines) {
    if (line.runs.length === 0) continue
    const text = line.runs
      .map((r) => r.text)
      .join('')
      .trim()
    if (text.length < MIN_HEADING_TEXT_LENGTH) continue
    const size = Math.round(line.fontSize * 10) / 10
    if (size > bodySize + 1.0) {
      headingSizeCount.set(size, (headingSizeCount.get(size) || 0) + 1)
    }
  }

  const headingSizes = Array.from(headingSizeCount.keys()).sort((a, b) => b - a)

  const headingLevels = new Map<number, number>()
  for (let i = 0; i < headingSizes.length && i < 6; i++) {
    headingLevels.set(headingSizes[i]!, i + 1)
  }

  // Bold-at-body-size headings get the next level after font-size headings.
  // E.g. if title is level 1, bold section headings become level 2.
  const boldHeadingLevel = Math.min(headingLevels.size + 1, 6)

  return {bodySize, headingLevels, boldHeadingLevel}
}

// ── List detection ───────────────────────────────────────────────────────────

const BULLET_PATTERNS = /^[\u2022\u2023\u25E6\u2043\u2219•·‣⁃○◦▪▸►–—-]\s+/
const NUMBERED_PATTERN = /^(\d+)[.)]\s+/
const LETTER_PATTERN = /^[a-zA-Z][.)]\s+/

function detectListType(text: string): {type: 'bullet' | 'numbered'; content: string} | null {
  const bulletMatch = text.match(BULLET_PATTERNS)
  if (bulletMatch) {
    return {type: 'bullet', content: text.slice(bulletMatch[0].length)}
  }

  const numberedMatch = text.match(NUMBERED_PATTERN)
  if (numberedMatch) {
    return {type: 'numbered', content: text.slice(numberedMatch[0].length)}
  }

  const letterMatch = text.match(LETTER_PATTERN)
  if (letterMatch) {
    return {type: 'numbered', content: text.slice(letterMatch[0].length)}
  }

  return null
}

// ── Extract text runs from pages ─────────────────────────────────────────────

async function extractTextRuns(doc: PdfDocument): Promise<TextLine[]> {
  const allLines: TextLine[] = []

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    await page.getOperatorList()
    const textContent = await page.getTextContent({includeMarkedContent: false})
    const items = textContent.items.filter(isTextItem)
    const styles = textContent.styles

    if (items.length === 0) continue

    // Build font info cache
    const fontInfoCache = new Map<string, {bold: boolean; italic: boolean; monospace: boolean}>()
    const getFontInfo = (fontName: string): {bold: boolean; italic: boolean; monospace: boolean} => {
      const cached = fontInfoCache.get(fontName)
      if (cached) return cached

      let bold = false
      let italic = false
      let monospace = false

      // Try commonObjs first (most reliable)
      try {
        if (page.commonObjs.has(fontName)) {
          const fontObj = page.commonObjs.get(fontName)
          if (fontObj) {
            bold = fontObj.bold === true || fontObj.black === true
            italic = fontObj.italic === true
            monospace = fontObj.isMonospace === true
            if (fontObj.name) {
              if (!monospace) monospace = isMonospaceFont(fontObj.name)
              if (!bold) bold = isBoldFont(fontObj.name)
              if (!italic) italic = isItalicFont(fontObj.name)
            }
          }
        }
      } catch {
        // commonObjs may not be available
      }

      // Fallback to styles fontFamily
      if (!bold && !italic && !monospace) {
        const style = styles[fontName]
        if (style?.fontFamily) {
          monospace = style.fontFamily === 'monospace' || isMonospaceFont(style.fontFamily)
        }
      }

      // Fallback to font name heuristics
      if (!bold) bold = isBoldFont(fontName)
      if (!italic) italic = isItalicFont(fontName)
      if (!monospace) monospace = isMonospaceFont(fontName)

      const info = {bold, italic, monospace}
      fontInfoCache.set(fontName, info)
      return info
    }

    // Group items into lines by Y position
    const lineGroups: TextItem[][] = []
    let currentLineItems: TextItem[] = []
    let currentY: number | null = null
    const Y_TOLERANCE = 2

    const sorted = [...items].sort((a, b) => {
      const yDiff = b.transform[5]! - a.transform[5]!
      if (Math.abs(yDiff) > Y_TOLERANCE) return yDiff
      return a.transform[4]! - b.transform[4]!
    })

    for (const item of sorted) {
      const y = item.transform[5]!
      if (currentY === null || Math.abs(y - currentY) > Y_TOLERANCE) {
        if (currentLineItems.length > 0) lineGroups.push(currentLineItems)
        currentLineItems = [item]
        currentY = y
      } else {
        currentLineItems.push(item)
      }
    }
    if (currentLineItems.length > 0) lineGroups.push(currentLineItems)

    // Convert to TextLine objects
    for (const group of lineGroups) {
      group.sort((a, b) => a.transform[4]! - b.transform[4]!)

      const runs: TextRun[] = group
        .filter((item) => item.str.length > 0)
        .map((item) => {
          const fontInfo = getFontInfo(item.fontName)
          return {
            text: item.str,
            fontSize: Math.abs(item.transform[3]!),
            fontName: item.fontName,
            x: item.transform[4]!,
            y: item.transform[5]!,
            width: item.width,
            bold: fontInfo.bold,
            italic: fontInfo.italic,
            monospace: fontInfo.monospace,
          }
        })

      if (runs.length === 0) continue

      const firstRun = runs[0]!
      allLines.push({
        runs,
        y: firstRun.y,
        x: firstRun.x,
        fontSize: firstRun.fontSize,
        fontName: firstRun.fontName,
        bold: runs.every((r) => r.bold),
        italic: runs.every((r) => r.italic),
        monospace: runs.every((r) => r.monospace),
        pageIndex: pageNum - 1,
      })
    }
  }

  return allLines
}

// ── Merge lines into paragraph groups ────────────────────────────────────────

interface ParagraphGroup {
  lines: TextLine[]
  type: 'paragraph' | 'heading' | 'code' | 'list-bullet' | 'list-numbered'
  headingLevel?: number
}

/** Max character length for a line to be considered a bold heading candidate. */
const BOLD_HEADING_MAX_LENGTH = 100

/** Normalize text for title comparison (trim, collapse whitespace, lowercase). */
function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

function groupLinesIntoParagraphs(
  lines: TextLine[],
  bodySize: number,
  headingLevels: Map<number, number>,
  boldHeadingLevel: number,
): ParagraphGroup[] {
  const groups: ParagraphGroup[] = []
  let currentGroup: ParagraphGroup | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const roundedSize = Math.round(line.fontSize * 10) / 10
    let headingLevel = headingLevels.get(roundedSize)
    const lineText = line.runs.map((r) => r.text).join('')
    const listInfo = detectListType(lineText)
    const isCode = line.monospace && !headingLevel

    // Bold-line heading heuristic: a short, bold, non-code line at or near
    // body size is treated as a section heading.  This intentionally ignores
    // listInfo so that bold numbered headings like "1. Introduction" are
    // detected as headings rather than list items.
    if (
      !headingLevel &&
      !isCode &&
      line.bold &&
      lineText.length > 0 &&
      lineText.length <= BOLD_HEADING_MAX_LENGTH &&
      Math.abs(roundedSize - bodySize) <= 1.5
    ) {
      headingLevel = boldHeadingLevel
    }

    let lineType: ParagraphGroup['type']
    if (headingLevel) {
      lineType = 'heading'
    } else if (isCode) {
      lineType = 'code'
    } else if (listInfo) {
      lineType = listInfo.type === 'bullet' ? 'list-bullet' : 'list-numbered'
    } else {
      lineType = 'paragraph'
    }

    const isPageBreak = i > 0 && lines[i - 1]!.pageIndex !== line.pageIndex

    const shouldStartNew =
      !currentGroup ||
      isPageBreak ||
      lineType === 'heading' ||
      currentGroup.type === 'heading' ||
      lineType === 'list-bullet' ||
      lineType === 'list-numbered' ||
      currentGroup.type === 'list-bullet' ||
      currentGroup.type === 'list-numbered' ||
      (lineType === 'code') !== (currentGroup.type === 'code') ||
      (i > 0 && !isPageBreak && Math.abs(lines[i - 1]!.y - line.y) > line.fontSize * 1.8 && lineType !== 'code')

    if (shouldStartNew) {
      if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup)
      currentGroup = {lines: [line], type: lineType, headingLevel}
    } else {
      currentGroup!.lines.push(line)
    }
  }

  if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup)

  return groups
}

// ── Convert runs to HM annotations ──────────────────────────────────────────

function runsToTextAndAnnotations(
  runs: TextRun[],
  allBold: boolean,
  allItalic: boolean,
): {text: string; annotations: HMAnnotation[]} {
  const annotations: HMAnnotation[] = []
  let text = ''

  for (const run of runs) {
    if (run.text.length === 0) continue

    const start = text.length
    text += run.text
    const end = text.length

    // Only annotate if the style differs from the uniform style of the group
    if (run.bold && !allBold) {
      annotations.push({type: 'Bold', starts: [start], ends: [end]})
    }
    if (run.italic && !allItalic) {
      annotations.push({type: 'Italic', starts: [start], ends: [end]})
    }
    if (run.monospace) {
      annotations.push({type: 'Code', starts: [start], ends: [end]})
    }
  }

  // Merge adjacent annotations of the same type
  const merged = mergeAdjacentAnnotations(annotations)

  return {text, annotations: merged}
}

function mergeAdjacentAnnotations(annotations: HMAnnotation[]): HMAnnotation[] {
  if (annotations.length <= 1) return annotations

  const byType = new Map<string, HMAnnotation[]>()
  for (const ann of annotations) {
    const list = byType.get(ann.type) || []
    list.push(ann)
    byType.set(ann.type, list)
  }

  const result: HMAnnotation[] = []
  for (const [, anns] of byType) {
    anns.sort((a, b) => (a.starts[0] ?? 0) - (b.starts[0] ?? 0))
    let current = {...anns[0]!, starts: [...anns[0]!.starts], ends: [...anns[0]!.ends]}
    for (let i = 1; i < anns.length; i++) {
      const next = anns[i]!
      if ((current.ends[0] ?? 0) >= (next.starts[0] ?? 0)) {
        current.ends[0] = Math.max(current.ends[0] ?? 0, next.ends[0] ?? 0)
      } else {
        result.push(current)
        current = {...next, starts: [...next.starts], ends: [...next.ends]}
      }
    }
    result.push(current)
  }

  result.sort((a, b) => (a.starts[0] ?? 0) - (b.starts[0] ?? 0))
  return result
}

// ── Heading hierarchy builder ────────────────────────────────────────────────

function buildHierarchy(blocks: {block: HMBlockNode; headingLevel?: number}[]): HMBlockNode[] {
  const result: HMBlockNode[] = []
  const stack: {level: number; node: HMBlockNode}[] = []

  for (const {block, headingLevel} of blocks) {
    if (headingLevel && headingLevel > 0) {
      while (stack.length && stack[stack.length - 1]!.level >= headingLevel) {
        stack.pop()
      }

      const parent = stack[stack.length - 1]
      if (parent) {
        if (!parent.node.children) parent.node.children = []
        parent.node.children.push(block)
      } else {
        result.push(block)
      }

      stack.push({level: headingLevel, node: block})
    } else {
      const parent = stack[stack.length - 1]
      if (parent) {
        if (!parent.node.children) parent.node.children = []
        parent.node.children.push(block)
      } else {
        result.push(block)
      }
    }
  }

  return result
}

// ── Title extraction ─────────────────────────────────────────────────────────

async function extractTitle(doc: PdfDocument): Promise<string | undefined> {
  if (doc.numPages === 0) return undefined

  const page = await doc.getPage(1)
  await page.getOperatorList()
  const textContent = await page.getTextContent({includeMarkedContent: false})
  const items = textContent.items.filter(isTextItem)

  if (items.length === 0) return undefined

  // Find the largest font size on the first page — likely the title
  let maxFontSize = 0
  let titleItems: TextItem[] = []

  for (const item of items) {
    const fontSize = Math.abs(item.transform[3]!)
    if (fontSize > maxFontSize + 0.5) {
      maxFontSize = fontSize
      titleItems = [item]
    } else if (Math.abs(fontSize - maxFontSize) <= 0.5) {
      titleItems.push(item)
    }
  }

  // Only treat as title if larger than the most common font
  const sizeCount = new Map<number, number>()
  for (const item of items) {
    const size = Math.round(Math.abs(item.transform[3]!) * 10) / 10
    sizeCount.set(size, (sizeCount.get(size) || 0) + 1)
  }
  const bodySize = Array.from(sizeCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 12

  if (maxFontSize <= bodySize + 0.5) {
    // All text is same size, use first line
    return (
      items
        .slice(0, 10)
        .map((item) => item.str)
        .join('')
        .trim()
        .slice(0, 100) || undefined
    )
  }

  titleItems.sort((a, b) => a.transform[4]! - b.transform[4]!)
  return (
    titleItems
      .map((item) => item.str)
      .join('')
      .trim() || undefined
  )
}

// ── Main converter ───────────────────────────────────────────────────────────

/**
 * Convert PDF binary data to HM blocks using pdfjs-dist (embedded, no server required).
 *
 * Uses font-size clustering for heading detection, font-name heuristics for
 * bold/italic/monospace, and regex patterns for list detection.
 *
 * @throws Error if pdfjs-dist is not installed
 */
export async function embeddedPdfToBlocks(pdfData: ArrayBuffer): Promise<EmbeddedPdfResult> {
  // Dynamic import — only loaded when this function is called.
  // pdfjs-dist is an optional peer dependency; types are defined locally above.
  let pdfjsLib: {getDocument: (params: {data: Uint8Array}) => {promise: Promise<unknown>}}
  try {
    // @ts-ignore — optional peer dependency, may not be installed
    pdfjsLib = await import('pdfjs-dist')
  } catch {
    throw new Error(
      'pdfjs-dist is not installed. Install it for embedded PDF extraction:\n' +
        '  pnpm add pdfjs-dist\n' +
        'Or provide a GROBID server URL for higher-fidelity extraction.',
    )
  }

  const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(pdfData)})
  const doc = (await loadingTask.promise) as unknown as PdfDocument

  if (doc.numPages === 0) {
    return {metadata: {name: undefined}, blocks: []}
  }

  // Extract title from first page (single pass)
  const title = await extractTitle(doc)

  // Extract all text lines
  const lines = await extractTextRuns(doc)

  if (lines.length === 0) {
    return {metadata: {name: title}, blocks: []}
  }

  // Cluster font sizes to determine body text and heading levels
  const {bodySize, headingLevels, boldHeadingLevel} = clusterFontSizes(lines)

  // Group lines into logical paragraphs
  const paragraphGroups = groupLinesIntoParagraphs(lines, bodySize, headingLevels, boldHeadingLevel)

  // Convert paragraph groups to HM blocks
  const flatBlocks: {block: HMBlockNode; headingLevel?: number}[] = []

  for (const group of paragraphGroups) {
    switch (group.type) {
      case 'heading': {
        const allRuns = group.lines.flatMap((l) => l.runs)
        const {text, annotations} = runsToTextAndAnnotations(allRuns, true, false)
        if (text) {
          flatBlocks.push({
            block: makeHeading(text, annotations),
            headingLevel: group.headingLevel,
          })
        }
        break
      }

      case 'code': {
        const codeText = group.lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n')
        if (codeText) {
          flatBlocks.push({block: makeCode(codeText)})
        }
        break
      }

      case 'list-bullet':
      case 'list-numbered': {
        const listType = group.type === 'list-bullet' ? 'Unordered' : 'Ordered'
        const items: HMBlockNode[] = []

        for (const line of group.lines) {
          const lineText = line.runs.map((r) => r.text).join('')
          const listInfo = detectListType(lineText)
          const contentText = listInfo ? listInfo.content : lineText
          items.push(makeParagraph(contentText))
        }

        if (items.length) {
          flatBlocks.push({block: makeList(items, listType)})
        }
        break
      }

      case 'paragraph':
      default: {
        const allRuns: TextRun[] = []
        const allBold = group.lines.every((l) => l.bold)
        const allItalic = group.lines.every((l) => l.italic)

        for (let i = 0; i < group.lines.length; i++) {
          const line = group.lines[i]!
          if (i > 0 && allRuns.length > 0) {
            const lastRun = allRuns[allRuns.length - 1]!
            if (lastRun.text.endsWith('-')) {
              lastRun.text = lastRun.text.slice(0, -1)
            } else if (!lastRun.text.endsWith(' ')) {
              allRuns.push({...line.runs[0]!, text: ' ', width: 0})
            }
          }
          allRuns.push(...line.runs)
        }

        const {text, annotations} = runsToTextAndAnnotations(allRuns, allBold, allItalic)
        if (text) {
          flatBlocks.push({block: makeParagraph(text, annotations)})
        }
        break
      }
    }
  }

  // Filter page numbers: standalone 1-3 digit numbers are typically page footers.
  const PAGE_NUMBER_RE = /^\d{1,3}$/
  for (let i = flatBlocks.length - 1; i >= 0; i--) {
    const entry = flatBlocks[i]!
    if (entry.headingLevel) continue // never remove headings
    const blockText = ((entry.block.block as {text?: string}).text || '').trim()
    if (PAGE_NUMBER_RE.test(blockText)) {
      flatBlocks.splice(i, 1)
    }
  }

  // Deduplicate title: if the first heading block matches the extracted title,
  // remove it (the title is already in metadata, no need to repeat it as content).
  if (title && flatBlocks.length > 0) {
    const first = flatBlocks[0]!
    if (first.headingLevel) {
      const blockText = (first.block.block as {text?: string}).text || ''
      if (normalizeForComparison(blockText) === normalizeForComparison(title)) {
        flatBlocks.shift()
      }
    }
  }

  // Organize blocks by heading hierarchy
  const blocks = buildHierarchy(flatBlocks)

  return {metadata: {name: title}, blocks}
}
