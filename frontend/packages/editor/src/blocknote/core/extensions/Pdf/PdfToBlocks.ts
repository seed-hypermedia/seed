import {nanoid} from 'nanoid'
import type {Block, BlockSchema, StyledText, Styles} from '../..'

// ── Types ────────────────────────────────────────────────────────────────────

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

function isTextItem(item: PageItem): item is TextItem {
  return 'str' in item
}

function isBoldFont(fontName: string): boolean {
  const lower = fontName.toLowerCase()
  return (
    lower.includes('bold') ||
    lower.includes('heavy') ||
    lower.includes('black')
  )
}

function isItalicFont(fontName: string): boolean {
  const lower = fontName.toLowerCase()
  return (
    lower.includes('italic') ||
    lower.includes('oblique') ||
    lower.includes('slant')
  )
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

function createBlock(
  type: string,
  props: Record<string, unknown> = {},
  content: StyledText[] = [],
  children: Block<BlockSchema>[] = [],
): Block<BlockSchema> {
  return {
    id: nanoid(10),
    type,
    props: {
      textAlignment: 'left',
      diff: 'null',
      childrenType: 'Group',
      listLevel: '1',
      ...props,
    },
    content,
    children,
  } as Block<BlockSchema>
}

// ── Font size clustering for heading detection ───────────────────────────────

interface FontSizeCluster {
  size: number
  count: number
}

function clusterFontSizes(lines: TextLine[]): {
  bodySize: number
  headingLevels: Map<number, number> // fontSize -> heading level (1,2,3)
} {
  const sizeCount = new Map<number, number>()

  for (const line of lines) {
    if (line.runs.length === 0) continue
    // Use rounded font size
    const size = Math.round(line.fontSize * 10) / 10
    sizeCount.set(size, (sizeCount.get(size) || 0) + 1)
  }

  if (sizeCount.size === 0) {
    return {bodySize: 12, headingLevels: new Map()}
  }

  // Sort clusters by count descending — most common is body text
  const clusters: FontSizeCluster[] = Array.from(sizeCount.entries())
    .map(([size, count]) => ({size, count}))
    .sort((a, b) => b.count - a.count)

  const bodySize = clusters[0]!.size

  // Sizes larger than body text are potential headings
  const headingSizes = clusters
    .filter((c) => c.size > bodySize + 0.5)
    .map((c) => c.size)
    .sort((a, b) => b - a) // largest first

  const headingLevels = new Map<number, number>()
  for (let i = 0; i < headingSizes.length && i < 3; i++) {
    headingLevels.set(headingSizes[i]!, i + 1)
  }

  return {bodySize, headingLevels}
}

// ── List detection ───────────────────────────────────────────────────────────

const BULLET_PATTERNS = /^[\u2022\u2023\u25E6\u2043\u2219•·‣⁃○◦▪▸►–—-]\s+/
const NUMBERED_PATTERN = /^(\d+)[.)]\s+/
const LETTER_PATTERN = /^[a-zA-Z][.)]\s+/

function detectListType(
  text: string,
): {type: 'bullet' | 'numbered'; content: string} | null {
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
    // Trigger font loading by getting operator list first
    await page.getOperatorList()
    const textContent = await page.getTextContent({includeMarkedContent: false})
    const items = textContent.items.filter(isTextItem)
    const styles = textContent.styles

    if (items.length === 0) continue

    // Build a font info cache from commonObjs and styles
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
            // Also check font name for monospace
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

    // Group items into lines by Y position (within tolerance)
    const lineGroups: TextItem[][] = []
    let currentLineItems: TextItem[] = []
    let currentY: number | null = null
    const Y_TOLERANCE = 2 // pixels

    // Sort by Y (descending, since PDF Y goes bottom-up) then X
    const sorted = [...items].sort((a, b) => {
      const yDiff = b.transform[5]! - a.transform[5]!
      if (Math.abs(yDiff) > Y_TOLERANCE) return yDiff
      return a.transform[4]! - b.transform[4]!
    })

    for (const item of sorted) {
      const y = item.transform[5]!
      if (currentY === null || Math.abs(y - currentY) > Y_TOLERANCE) {
        if (currentLineItems.length > 0) {
          lineGroups.push(currentLineItems)
        }
        currentLineItems = [item]
        currentY = y
      } else {
        currentLineItems.push(item)
      }
    }
    if (currentLineItems.length > 0) {
      lineGroups.push(currentLineItems)
    }

    // Convert line groups to TextLine objects
    for (const group of lineGroups) {
      // Sort by X within line
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

// ── Merge lines into paragraphs ──────────────────────────────────────────────

interface ParagraphGroup {
  lines: TextLine[]
  type: 'paragraph' | 'heading' | 'code' | 'list-bullet' | 'list-numbered'
  headingLevel?: number
}

function groupLinesIntoParagraphs(
  lines: TextLine[],
  bodySize: number,
  headingLevels: Map<number, number>,
): ParagraphGroup[] {
  const groups: ParagraphGroup[] = []
  let currentGroup: ParagraphGroup | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const roundedSize = Math.round(line.fontSize * 10) / 10
    const headingLevel = headingLevels.get(roundedSize)
    const lineText = line.runs.map((r) => r.text).join('')

    // Detect list items
    const listInfo = detectListType(lineText)

    // Detect code blocks (monospace lines)
    const isCode = line.monospace && !headingLevel

    // Determine line type
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

    // Check if we should continue the current group or start a new one
    // Page break always starts new group
    const isPageBreak =
      i > 0 && lines[i - 1]!.pageIndex !== line.pageIndex

    const shouldStartNew =
      !currentGroup ||
      isPageBreak ||
      // Headings always start new groups
      lineType === 'heading' ||
      currentGroup.type === 'heading' ||
      // List items are individual
      lineType === 'list-bullet' ||
      lineType === 'list-numbered' ||
      currentGroup.type === 'list-bullet' ||
      currentGroup.type === 'list-numbered' ||
      // Code blocks group together but not with non-code
      (lineType === 'code') !== (currentGroup.type === 'code') ||
      // Large Y gap means new paragraph (more than 1.5x line height)
      (i > 0 &&
        !isPageBreak &&
        Math.abs(lines[i - 1]!.y - line.y) > line.fontSize * 1.8 &&
        lineType !== 'code')

    if (shouldStartNew) {
      if (currentGroup && currentGroup.lines.length > 0) {
        groups.push(currentGroup)
      }
      currentGroup = {
        lines: [line],
        type: lineType,
        headingLevel: headingLevel,
      }
    } else {
      currentGroup!.lines.push(line)
    }
  }

  if (currentGroup && currentGroup.lines.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

// ── Convert runs to styled text ──────────────────────────────────────────────

function runsToStyledText(runs: TextRun[], allBold: boolean, allItalic: boolean): StyledText[] {
  const result: StyledText[] = []

  for (const run of runs) {
    if (run.text.length === 0) continue

    const styles: Styles = {}

    // Only mark bold/italic if not all runs share the same style
    // (avoids marking heading text as "bold" when the whole heading is bold)
    if (run.bold && !allBold) styles.bold = true
    if (run.italic && !allItalic) styles.italic = true
    if (run.monospace) styles.code = true

    // Merge with previous run if same styles
    const prev = result[result.length - 1]
    if (
      prev &&
      prev.type === 'text' &&
      JSON.stringify(prev.styles) === JSON.stringify(styles)
    ) {
      prev.text += run.text
    } else {
      result.push({
        type: 'text',
        text: run.text,
        styles,
      })
    }
  }

  return result
}

// ── Main converter ───────────────────────────────────────────────────────────

/**
 * Convert PDF binary data to BlockNote blocks.
 * Uses pdfjs-dist for text extraction.
 */
export async function PdfToBlocks(
  pdfData: ArrayBuffer,
): Promise<Block<BlockSchema>[]> {
  // Dynamic import of pdfjs-dist to handle environments where it may not be available
  const pdfjsLib = await import('pdfjs-dist')

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(pdfData) as Uint8Array<ArrayBuffer>})
  const doc = await loadingTask.promise as unknown as PdfDocument

  if (doc.numPages === 0) {
    return []
  }

  // Extract all text lines
  const lines = await extractTextRuns(doc)

  if (lines.length === 0) {
    return []
  }

  // Cluster font sizes to determine body text and heading levels
  const {bodySize, headingLevels} = clusterFontSizes(lines)

  // Group lines into logical paragraphs
  const paragraphGroups = groupLinesIntoParagraphs(
    lines,
    bodySize,
    headingLevels,
  )

  // Convert paragraph groups to blocks
  const blocks: Block<BlockSchema>[] = []

  for (const group of paragraphGroups) {
    switch (group.type) {
      case 'heading': {
        const level = String(group.headingLevel || 1)
        const allRuns = group.lines.flatMap((l) => l.runs)
        const content = runsToStyledText(allRuns, true, false)
        if (content.length > 0) {
          blocks.push(createBlock('heading', {level}, content))
        }
        break
      }

      case 'code': {
        const codeText = group.lines
          .map((l) => l.runs.map((r) => r.text).join(''))
          .join('\n')
        blocks.push(
          createBlock('code-block', {language: ''}, [
            {type: 'text', text: codeText, styles: {}},
          ]),
        )
        break
      }

      case 'list-bullet':
      case 'list-numbered': {
        const childrenType =
          group.type === 'list-bullet' ? 'Unordered' : 'Ordered'
        const listChildren: Block<BlockSchema>[] = []

        for (const line of group.lines) {
          const lineText = line.runs.map((r) => r.text).join('')
          const listInfo = detectListType(lineText)
          const contentText = listInfo ? listInfo.content : lineText
          const allBold = line.runs.every((r) => r.bold)
          const allItalic = line.runs.every((r) => r.italic)

          // Build styled text from the content (after stripping the bullet/number)
          const styledContent: StyledText[] = [{
            type: 'text',
            text: contentText,
            styles: {
              ...(allBold ? {bold: true} : {}),
              ...(allItalic ? {italic: true} : {}),
            } as Styles,
          }]

          listChildren.push(
            createBlock('paragraph', {type: 'p'}, styledContent),
          )
        }

        blocks.push(
          createBlock(
            'paragraph',
            {type: 'p', childrenType},
            [],
            listChildren,
          ),
        )
        break
      }

      case 'paragraph':
      default: {
        // Merge all runs from all lines with spaces between lines
        const allRuns: TextRun[] = []
        const allBold = group.lines.every((l) => l.bold)
        const allItalic = group.lines.every((l) => l.italic)

        for (let i = 0; i < group.lines.length; i++) {
          const line = group.lines[i]!
          if (i > 0 && allRuns.length > 0) {
            // Add space between lines if the previous run doesn't end with space/hyphen
            const lastRun = allRuns[allRuns.length - 1]!
            if (lastRun.text.endsWith('-')) {
              // Hyphenated word — remove hyphen and join
              lastRun.text = lastRun.text.slice(0, -1)
            } else if (!lastRun.text.endsWith(' ')) {
              allRuns.push({
                ...line.runs[0]!,
                text: ' ',
                width: 0,
              })
            }
          }
          allRuns.push(...line.runs)
        }

        const content = runsToStyledText(allRuns, allBold, allItalic)
        if (content.length > 0) {
          blocks.push(createBlock('paragraph', {type: 'p'}, content))
        }
        break
      }
    }
  }

  // Organize blocks by heading hierarchy
  const organizedBlocks: Block<BlockSchema>[] = []
  const stack: {level: number; block: Block<BlockSchema>}[] = []

  for (const block of blocks) {
    const headingLevel =
      block.type === 'heading'
        ? parseInt(String((block.props as Record<string, unknown>).level), 10)
        : 0

    if (headingLevel > 0) {
      while (stack.length && stack[stack.length - 1]!.level >= headingLevel) {
        stack.pop()
      }

      const parent = stack[stack.length - 1]
      if (parent) {
        parent.block.children.push(block)
      } else {
        organizedBlocks.push(block)
      }

      stack.push({level: headingLevel, block})
    } else {
      const parent = stack[stack.length - 1]
      if (parent) {
        parent.block.children.push(block)
      } else {
        organizedBlocks.push(block)
      }
    }
  }

  return organizedBlocks
}

/**
 * Extract a title from PDF content (first heading or first line of text).
 */
export async function extractPdfTitle(
  pdfData: ArrayBuffer,
): Promise<string | undefined> {
  try {
    const pdfjsLib = await import('pdfjs-dist')
    const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(pdfData) as Uint8Array<ArrayBuffer>})
    const doc = await loadingTask.promise

    if (doc.numPages === 0) return undefined

    const page = await doc.getPage(1)
    const textContent = await page.getTextContent({includeMarkedContent: false})
    const items = (textContent.items as PageItem[]).filter(isTextItem)

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

    // Only treat as title if the largest font is bigger than the most common font
    // Count font sizes to find body size
    const sizeCount = new Map<number, number>()
    for (const item of items) {
      const size = Math.round(Math.abs(item.transform[3]!) * 10) / 10
      sizeCount.set(size, (sizeCount.get(size) || 0) + 1)
    }
    const bodySize = Array.from(sizeCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 12
    
    // Only use as title if it's larger than body text
    if (maxFontSize <= bodySize + 0.5) {
      // All text is same size, use first line
      return items
        .slice(0, 10)
        .map((item) => item.str)
        .join('')
        .trim()
        .slice(0, 100) || undefined
    }

    // Sort title items by position (left to right)
    titleItems.sort((a, b) => a.transform[4]! - b.transform[4]!)

    if (titleItems.length > 0) {
      return titleItems.map((item) => item.str).join('').trim() || undefined
    }

    // Fallback: first line of text
    return items
      .slice(0, 10)
      .map((item) => item.str)
      .join('')
      .trim()
      .slice(0, 100) || undefined
  } catch {
    return undefined
  }
}
