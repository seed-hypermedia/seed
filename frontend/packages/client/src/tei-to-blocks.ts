/**
 * TEI XML to Seed HMBlockNode converter.
 *
 * Converts GROBID TEI output into the Seed Hypermedia block model.
 * Follows the same patterns as html-to-blocks.ts in @shm/shared.
 */
import * as cheerio from 'cheerio'
import {codePointLength} from '@shm/shared/client/unicode'
import type {HMAnnotation, HMBlockNode, HMMetadata} from '@shm/shared/hm-types'

// ── Public types ──────────────────────────────────────────────────────

/** Bounding-box information GROBID attaches when `teiCoordinates=figure`. */
export type FigureCoords = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

/** Information about a figure extracted from the TEI. */
export type TeiFigure = {
  id: string
  label: string
  caption: string
  coords: FigureCoords | null
}

/** Options for the TEI-to-blocks converter. */
export type TeiToBlocksOptions = {
  /**
   * Called for each `<figure>` that has bounding-box coordinates.
   * Return an `ipfs://CID` URL string to embed the image, or `null` to skip.
   */
  extractFigureImage?: (figure: TeiFigure) => Promise<string | null>
}

/** Result of the TEI-to-blocks conversion. */
export type TeiToBlocksResult = {
  metadata: Pick<HMMetadata, 'name' | 'summary' | 'displayPublishTime' | 'displayAuthor'>
  blocks: HMBlockNode[]
}

// ── Helpers ───────────────────────────────────────────────────────────

function generateBlockId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

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

function makeHeading(text: string): HMBlockNode {
  return makeBlock('Heading', text, {
    attributes: {childrenType: 'Group' as const},
  })
}

function makeParagraph(text: string, annotations: HMAnnotation[] = []): HMBlockNode {
  return makeBlock('Paragraph', text, {annotations})
}

function makeMath(text: string): HMBlockNode {
  return makeBlock('Math', text)
}

function makeCode(text: string, language = ''): HMBlockNode {
  return makeBlock('Code', text, {
    attributes: language ? {language} : {},
  })
}

function makeImage(link: string, caption = ''): HMBlockNode {
  return makeBlock('Image', caption, {link})
}

function makeList(items: HMBlockNode[], listType: 'Ordered' | 'Unordered'): HMBlockNode {
  const container = makeBlock('Paragraph', '', {
    attributes: {childrenType: listType},
  })
  container.children = items
  return container
}

// ── Inline parsing ────────────────────────────────────────────────────

/**
 * Walk a TEI element's children and produce plain text + annotations.
 * Handles <hi rend="bold|italic|sup|sub">, <ref>, and nested structures.
 */
function parseInlineContent(
  _$: ReturnType<typeof cheerio.load>,
  el: ReturnType<ReturnType<typeof cheerio.load>>,
): {text: string; annotations: HMAnnotation[]} {
  const annotations: HMAnnotation[] = []
  let text = ''

  function walk(node: any, active: {bold?: boolean; italic?: boolean; code?: boolean; link?: string}): void {
    if (node.type === 'text') {
      const raw = node.data || ''
      // Collapse whitespace runs (TEI has lots of whitespace)
      const normalized = raw.replace(/\s+/g, ' ')
      text += normalized
      return
    }
    if (node.type !== 'tag') return

    let isBold = active.bold || false
    let isItalic = active.italic || false
    let isCode = active.code || false
    let linkHref = active.link

    const tagName: string = node.name?.toLowerCase() || ''

    // TEI <hi rend="..."> for inline formatting
    if (tagName === 'hi') {
      const rend: string = node.attribs?.rend || ''
      if (rend === 'bold' || rend === 'b') isBold = true
      if (rend === 'italic' || rend === 'i') isItalic = true
      if (rend === 'monospace' || rend === 'code') isCode = true
      // sup/sub: no Seed equivalent, just render as plain text
    }

    // TEI <ref> for cross-references
    if (tagName === 'ref') {
      const target: string | undefined = node.attribs?.target
      if (target && target.startsWith('http')) {
        linkHref = target
      }
      // For internal refs (#b0, etc.) we keep as plain text
    }

    const start = codePointLength(text)

    // Walk children
    for (const child of node.children || []) {
      walk(child, {bold: isBold, italic: isItalic, code: isCode, link: linkHref})
    }

    const end = codePointLength(text)
    if (end <= start) return

    if (isBold && !active.bold && tagName === 'hi') {
      annotations.push({type: 'Bold', starts: [start], ends: [end]})
    }
    if (isItalic && !active.italic && tagName === 'hi') {
      annotations.push({type: 'Italic', starts: [start], ends: [end]})
    }
    if (isCode && !active.code && tagName === 'hi') {
      annotations.push({type: 'Code', starts: [start], ends: [end]})
    }
    if (linkHref && !active.link && tagName === 'ref') {
      annotations.push({
        type: 'Link',
        starts: [start],
        ends: [end],
        link: linkHref,
      })
    }
  }

  // Walk each child node
  for (const child of el.contents().toArray()) {
    walk(child, {})
  }

  // Trim and adjust positions
  const trimmedText = text.trim()
  const leadingLen = text.length - text.trimStart().length

  const adjustedAnnotations = annotations
    .map((a) => ({
      ...a,
      starts: a.starts.map((p: number) => Math.max(0, p - leadingLen)),
      ends: a.ends.map((p: number) => Math.max(0, p - leadingLen)),
    }))
    .filter((a) => (a.ends[0] ?? 0) > (a.starts[0] ?? 0))

  adjustedAnnotations.sort((a, b) => {
    const aStart = a.starts[0] ?? 0
    const bStart = b.starts[0] ?? 0
    if (aStart !== bStart) return aStart - bStart
    const aEnd = a.ends[0] ?? 0
    const bEnd = b.ends[0] ?? 0
    if (aEnd !== bEnd) return aEnd - bEnd
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0
  })

  return {text: trimmedText, annotations: adjustedAnnotations}
}

// ── Metadata extraction ───────────────────────────────────────────────

type $ = ReturnType<typeof cheerio.load>

function extractTitle($: $): string {
  // Look for the main article title in teiHeader
  const titleEl = $('teiHeader fileDesc titleStmt title[level="a"]')
  if (titleEl.length) return titleEl.text().trim()
  // Fallback to any title in titleStmt
  const anyTitle = $('teiHeader fileDesc titleStmt title')
  if (anyTitle.length) return anyTitle.first().text().trim()
  return ''
}

function extractAuthors($: $): string {
  const authors: string[] = []
  $('teiHeader fileDesc sourceDesc biblStruct analytic author persName').each((_i, el) => {
    const forenames: string[] = []
    $(el)
      .find('forename')
      .each((_j, fn) => {
        forenames.push($(fn).text().trim())
      })
    const surname = $(el).find('surname').text().trim()
    const name = [...forenames, surname].filter(Boolean).join(' ')
    if (name) authors.push(name)
  })
  // Fallback: authors directly under analytic
  if (authors.length === 0) {
    $('teiHeader sourceDesc biblStruct analytic author').each((_i, el) => {
      const persName = $(el).find('persName')
      if (persName.length) {
        const forenames: string[] = []
        persName.find('forename').each((_j, fn) => {
          forenames.push($(fn).text().trim())
        })
        const surname = persName.find('surname').text().trim()
        const name = [...forenames, surname].filter(Boolean).join(' ')
        if (name) authors.push(name)
      }
    })
  }
  return authors.join(', ')
}

function extractAbstract($: $): string {
  const abs = $('teiHeader profileDesc abstract')
  if (!abs.length) return ''
  const parts: string[] = []
  abs.find('p').each((_i, el) => {
    const t = $(el).text().trim()
    if (t) parts.push(t)
  })
  if (parts.length) return parts.join('\n\n')
  // Fallback: direct text
  return abs.text().trim()
}

function extractDate($: $): string {
  const dateEl = $('teiHeader fileDesc publicationStmt date[type="published"]')
  const when = dateEl.attr('when')
  if (when) return when
  return dateEl.text().trim()
}

// ── Figure coordinate parsing ─────────────────────────────────────────

function parseCoords(coordsStr: string | undefined): FigureCoords | null {
  if (!coordsStr) return null
  // Format: "page,x,y,width,height" — may have multiple bboxes separated by ";"
  const first = coordsStr.split(';')[0]
  if (!first) return null
  const parts = first.split(',').map(Number)
  if (parts.length < 5 || parts.some(isNaN)) return null
  return {
    page: parts[0]!,
    x: parts[1]!,
    y: parts[2]!,
    width: parts[3]!,
    height: parts[4]!,
  }
}

// ── Table formatting ──────────────────────────────────────────────────

function formatTable($: $, tableEl: ReturnType<$>): string {
  const rows: string[][] = []
  tableEl.find('row').each((_i, row) => {
    const cells: string[] = []
    $(row)
      .find('cell')
      .each((_j, cell) => {
        cells.push($(cell).text().trim())
      })
    rows.push(cells)
  })

  if (rows.length === 0) return tableEl.text().trim()

  // Find max column widths for alignment
  const colWidths: number[] = []
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i] || 0, (row[i] || '').length)
    }
  }

  // Format as a plain text table
  const lines: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const line = row.map((cell, c) => cell.padEnd(colWidths[c] || 0)).join(' | ')
    lines.push(line)
    // Add separator after first row (header)
    if (r === 0) {
      lines.push(colWidths.map((w) => '-'.repeat(w)).join('-+-'))
    }
  }
  return lines.join('\n')
}

// ── Bibliography formatting ───────────────────────────────────────────

function formatBiblStruct($: $, bib: ReturnType<$>): string {
  const authors: string[] = []
  bib.find('author persName').each((_i, el) => {
    const forenames: string[] = []
    $(el)
      .find('forename')
      .each((_j, fn) => {
        forenames.push($(fn).text().trim())
      })
    const surname = $(el).find('surname').text().trim()
    const name = [...forenames, surname].filter(Boolean).join(' ')
    if (name) authors.push(name)
  })

  const title = bib.find('analytic title').text().trim() || bib.find('monogr title').text().trim()
  const journal = bib.find('monogr title[level="j"]').text().trim()
  const volume = bib.find('biblScope[unit="volume"]').text().trim()
  const pages = bib.find('biblScope[unit="page"]')
  const from = pages.attr('from') || ''
  const to = pages.attr('to') || ''
  const pageStr = from && to ? `${from}-${to}` : pages.text().trim()
  const year = bib.find('date[type="published"]').attr('when') || bib.find('date[type="published"]').text().trim()
  const doi = bib.find('idno[type="DOI"]').text().trim()

  const parts: string[] = []
  if (authors.length) parts.push(authors.join(', '))
  if (title) parts.push(`"${title}"`)
  if (journal) {
    let jPart = journal
    if (volume) jPart += ` ${volume}`
    if (pageStr) jPart += `: ${pageStr}`
    parts.push(jPart)
  }
  if (year) parts.push(`(${year})`)
  let result = parts.join('. ')
  if (doi) result += `. DOI: ${doi}`
  return result || bib.text().trim().replace(/\s+/g, ' ')
}

// ── Main body processing ──────────────────────────────────────────────

type ProcessedElement = {
  type: 'heading' | 'content'
  level?: number
  blockNode: HMBlockNode
}

/** Infer heading level from a <head> element. */
function inferHeadingLevel(_$: $, headEl: ReturnType<$>): number {
  // Check parent div nesting depth
  let depth = 0
  let parent = headEl.parent()
  while (parent.length) {
    const tag = (parent[0] as any)?.name?.toLowerCase()
    if (tag === 'body' || tag === 'text') break
    if (tag === 'div') depth++
    parent = parent.parent()
  }
  // Map depth to heading level: depth 1 = H2, depth 2 = H3, etc.
  // (H1 is reserved for document title which is in metadata)
  return Math.min(depth + 1, 6)
}

async function processBodyElements($: $, bodyEl: ReturnType<$>, opts: TeiToBlocksOptions): Promise<ProcessedElement[]> {
  const elements: ProcessedElement[] = []

  // Recursively walk all direct children of the body and nested divs
  async function walkChildren(container: ReturnType<$>): Promise<void> {
    for (const child of container.children().toArray()) {
      const $child = $(child)
      const tagName: string = (child as any).name?.toLowerCase() || ''

      if (tagName === 'div') {
        // Divs are section containers — recurse into them
        await walkChildren($child)
        continue
      }

      if (tagName === 'head') {
        const text = $child.text().trim()
        if (!text) continue
        const level = inferHeadingLevel($, $child)
        const heading = makeHeading(text)
        elements.push({type: 'heading', level, blockNode: heading})
        continue
      }

      if (tagName === 'p') {
        const {text, annotations} = parseInlineContent($, $child)
        if (!text) continue
        elements.push({
          type: 'content',
          blockNode: makeParagraph(text, annotations),
        })
        continue
      }

      if (tagName === 'formula') {
        const label = $child.find('label').text().trim()
        // Remove the label from formula text to avoid duplication
        $child.find('label').remove()
        let formulaText = $child.text().trim()
        if (label) formulaText = `${formulaText} (${label})`
        if (formulaText) {
          elements.push({
            type: 'content',
            blockNode: makeMath(formulaText),
          })
        }
        continue
      }

      if (tagName === 'figure') {
        const figType = $child.attr('type')

        if (figType === 'table') {
          // Table figure
          const label = $child.find('head').text().trim()
          const caption = $child.find('figDesc').text().trim()
          const tableEl = $child.find('table')
          let tableText = ''
          if (tableEl.length) {
            tableText = formatTable($, tableEl)
          } else {
            tableText = $child.text().trim()
          }
          const header = [label, caption].filter(Boolean).join(': ')
          const fullText = header ? `${header}\n\n${tableText}` : tableText
          if (fullText) {
            elements.push({
              type: 'content',
              blockNode: makeCode(fullText),
            })
          }
          continue
        }

        // Regular figure
        const figId = $child.attr('xml:id') || ''
        const label = $child.find('label').text().trim()
        const caption = $child.find('figDesc').text().trim()
        const coordsStr = $child.attr('coords')
        const coords = parseCoords(coordsStr)

        const figureInfo: TeiFigure = {id: figId, label, caption, coords}
        let imageLink: string | null = null

        if (opts.extractFigureImage && coords) {
          imageLink = await opts.extractFigureImage(figureInfo)
        }

        if (imageLink) {
          const captionText = [label ? `Figure ${label}` : '', caption].filter(Boolean).join(': ')
          elements.push({
            type: 'content',
            blockNode: makeImage(imageLink, captionText),
          })
        } else {
          // No image extraction — render as a captioned paragraph
          const captionText = [label ? `Figure ${label}` : 'Figure', caption].filter(Boolean).join(': ')
          if (captionText) {
            elements.push({
              type: 'content',
              blockNode: makeParagraph(captionText, [
                {
                  type: 'Italic',
                  starts: [0],
                  ends: [codePointLength(captionText)],
                },
              ]),
            })
          }
        }
        continue
      }

      if (tagName === 'list') {
        const items: HMBlockNode[] = []
        $child.find('item').each((_i, item) => {
          const {text, annotations} = parseInlineContent($, $(item))
          if (text) items.push(makeParagraph(text, annotations))
        })
        if (items.length) {
          elements.push({
            type: 'content',
            blockNode: makeList(items, 'Unordered'),
          })
        }
        continue
      }

      if (tagName === 'note') {
        // Footnotes and other notes — render as italic paragraphs
        const {text, annotations} = parseInlineContent($, $child)
        if (text) {
          annotations.push({
            type: 'Italic',
            starts: [0],
            ends: [codePointLength(text)],
          })
          elements.push({
            type: 'content',
            blockNode: makeParagraph(text, annotations),
          })
        }
        continue
      }
    }
  }

  await walkChildren(bodyEl)
  return elements
}

// ── Back matter (references) ──────────────────────────────────────────

function processReferences($: $): ProcessedElement[] {
  const elements: ProcessedElement[] = []
  const biblStructs = $('back listBibl biblStruct')
  if (!biblStructs.length) return elements

  elements.push({
    type: 'heading',
    level: 2,
    blockNode: makeHeading('References'),
  })

  biblStructs.each((_i, bib) => {
    const formatted = formatBiblStruct($, $(bib))
    if (formatted) {
      elements.push({
        type: 'content',
        blockNode: makeParagraph(`[${_i + 1}] ${formatted}`),
      })
    }
  })

  return elements
}

// ── Hierarchy builder ─────────────────────────────────────────────────

/**
 * Build a hierarchical HMBlockNode[] tree from flat processed elements.
 * Uses the same heading-stack algorithm as html-to-blocks.ts.
 */
function buildHierarchy(elements: ProcessedElement[]): HMBlockNode[] {
  const blocks: HMBlockNode[] = []
  const headingStack: {level: number; blockNode: HMBlockNode}[] = []

  for (const element of elements) {
    if (element.type === 'heading' && element.level && element.blockNode) {
      // Pop headings at same or deeper level
      while (headingStack.length > 0 && (headingStack[headingStack.length - 1]?.level ?? 0) >= element.level) {
        headingStack.pop()
      }

      if (headingStack.length === 0) {
        blocks.push(element.blockNode)
      } else {
        const parent = headingStack[headingStack.length - 1]!.blockNode
        if (!parent.children) parent.children = []
        parent.children.push(element.blockNode)
      }

      headingStack.push({level: element.level, blockNode: element.blockNode})
    } else if (element.type === 'content' && element.blockNode) {
      if (headingStack.length === 0) {
        blocks.push(element.blockNode)
      } else {
        const parent = headingStack[headingStack.length - 1]!.blockNode
        if (!parent.children) parent.children = []
        parent.children.push(element.blockNode)
      }
    }
  }

  return blocks
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Convert GROBID TEI XML into Seed Hypermedia blocks and metadata.
 *
 * @param teiXml - Raw TEI XML string from GROBID's processFulltextDocument
 * @param opts - Optional callbacks for figure image extraction
 * @returns Metadata (title, authors, abstract) and block tree
 *
 * @example
 * ```ts
 * const teiXml = await fetch('http://localhost:8070/api/processFulltextDocument', {
 *   method: 'POST',
 *   body: formData,
 * }).then(r => r.text())
 *
 * const {metadata, blocks} = await teiToBlocks(teiXml, {
 *   extractFigureImage: async (fig) => {
 *     // render PDF region, upload to IPFS, return ipfs://CID
 *     return `ipfs://${cid}`
 *   },
 * })
 * ```
 */
export async function teiToBlocks(teiXml: string, opts: TeiToBlocksOptions = {}): Promise<TeiToBlocksResult> {
  const $ = cheerio.load(teiXml, {xml: true})

  // ── Extract metadata ──
  const title = extractTitle($)
  const displayAuthor = extractAuthors($)
  const summary = extractAbstract($)
  const displayPublishTime = extractDate($)

  const metadata: TeiToBlocksResult['metadata'] = {
    name: title,
    ...(displayAuthor ? {displayAuthor} : {}),
    ...(summary ? {summary} : {}),
    ...(displayPublishTime ? {displayPublishTime} : {}),
  }

  // ── Build content blocks ──
  const allElements: ProcessedElement[] = []

  // Abstract as content (also in metadata.summary)
  const abstractEl = $('teiHeader profileDesc abstract')
  if (abstractEl.length) {
    allElements.push({
      type: 'heading',
      level: 2,
      blockNode: makeHeading('Abstract'),
    })
    abstractEl.find('p').each((_i, p) => {
      const {text, annotations} = parseInlineContent($, $(p))
      if (text) {
        allElements.push({
          type: 'content',
          blockNode: makeParagraph(text, annotations),
        })
      }
    })
    // Fallback: abstract has no <p> children, use direct text
    if (!abstractEl.find('p').length) {
      const absText = abstractEl.text().trim()
      if (absText) {
        allElements.push({
          type: 'content',
          blockNode: makeParagraph(absText),
        })
      }
    }
  }

  // Body content
  const body = $('text body')
  if (body.length) {
    const bodyElements = await processBodyElements($, body, opts)
    allElements.push(...bodyElements)
  }

  // Back matter: acknowledgements
  const ack = $('back div[type="acknowledgement"], back div[type="acknowledgment"]')
  if (ack.length) {
    allElements.push({
      type: 'heading',
      level: 2,
      blockNode: makeHeading('Acknowledgements'),
    })
    ack.find('p').each((_i, p) => {
      const {text, annotations} = parseInlineContent($, $(p))
      if (text) {
        allElements.push({
          type: 'content',
          blockNode: makeParagraph(text, annotations),
        })
      }
    })
  }

  // References
  allElements.push(...processReferences($))

  // Build hierarchy
  const blocks = buildHierarchy(allElements)

  return {metadata, blocks}
}
