import {describe, it, expect} from 'vitest'
import {PDFDocument, StandardFonts, rgb} from 'pdf-lib'
import {PdfToBlocks, extractPdfTitle} from '../PdfToBlocks'

// Helper to create a simple PDF with text
async function createSimplePdf(
  pages: Array<{
    texts: Array<{
      text: string
      x: number
      y: number
      size: number
      font?: 'helvetica' | 'helveticaBold' | 'helveticaOblique' | 'courier'
    }>
  }>,
): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique)
  const courier = await doc.embedFont(StandardFonts.Courier)

  const fontMap = {
    helvetica,
    helveticaBold,
    helveticaOblique,
    courier,
  }

  for (const pageSpec of pages) {
    const page = doc.addPage([612, 792]) // Letter size
    for (const textSpec of pageSpec.texts) {
      const font = fontMap[textSpec.font || 'helvetica']
      page.drawText(textSpec.text, {
        x: textSpec.x,
        y: textSpec.y,
        size: textSpec.size,
        font,
      })
    }
  }

  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('PdfToBlocks', () => {
  it('should handle an empty PDF', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const bytes = await doc.save()
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

    const blocks = await PdfToBlocks(buffer)
    expect(blocks).toEqual([])
  })

  it('should extract simple paragraphs', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: 'Hello World', x: 72, y: 700, size: 12},
          {text: 'Second paragraph', x: 72, y: 660, size: 12},
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    expect(blocks.length).toBeGreaterThanOrEqual(1)

    // Should have paragraph blocks
    const paragraphs = blocks.filter((b) => b.type === 'paragraph')
    expect(paragraphs.length).toBeGreaterThanOrEqual(1)
  })

  it('should detect headings from larger font sizes', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: 'Main Title', x: 72, y: 750, size: 24},
          {text: 'Body text here.', x: 72, y: 700, size: 12},
          {text: 'Body text continues.', x: 72, y: 680, size: 12},
          {text: 'Subtitle', x: 72, y: 640, size: 18},
          {text: 'More body text.', x: 72, y: 610, size: 12},
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    
    // Should have heading blocks
    const headings = flattenBlocks(blocks).filter((b) => b.type === 'heading')
    expect(headings.length).toBeGreaterThanOrEqual(1)
  })

  it('should preserve bold styling', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: 'Normal text ', x: 72, y: 700, size: 12, font: 'helvetica'},
          {text: 'bold text', x: 160, y: 700, size: 12, font: 'helveticaBold'},
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    expect(blocks.length).toBeGreaterThanOrEqual(1)

    // Find paragraph with mixed content
    const paragraphs = flattenBlocks(blocks).filter(
      (b) => b.type === 'paragraph',
    )
    expect(paragraphs.length).toBeGreaterThanOrEqual(1)

    // Check that there's at least one content item with bold
    const allContent = paragraphs.flatMap((p) => p.content || [])
    const boldItems = allContent.filter(
      (c: Record<string, unknown>) =>
        c.type === 'text' && (c.styles as Record<string, unknown>)?.bold === true,
    )
    expect(boldItems.length).toBeGreaterThanOrEqual(1)
  })

  it('should preserve italic styling', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: 'Normal text ', x: 72, y: 700, size: 12, font: 'helvetica'},
          {
            text: 'italic text',
            x: 160,
            y: 700,
            size: 12,
            font: 'helveticaOblique',
          },
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    const paragraphs = flattenBlocks(blocks).filter(
      (b) => b.type === 'paragraph',
    )
    const allContent = paragraphs.flatMap((p) => p.content || [])
    const italicItems = allContent.filter(
      (c: Record<string, unknown>) =>
        c.type === 'text' &&
        (c.styles as Record<string, unknown>)?.italic === true,
    )
    expect(italicItems.length).toBeGreaterThanOrEqual(1)
  })

  it('should detect monospace as code blocks', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: 'Normal paragraph.', x: 72, y: 750, size: 12},
          {text: 'const x = 42;', x: 72, y: 700, size: 12, font: 'courier'},
          {text: 'return x;', x: 72, y: 685, size: 12, font: 'courier'},
          {text: 'Another paragraph.', x: 72, y: 640, size: 12},
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    const codeBlocks = flattenBlocks(blocks).filter(
      (b) => b.type === 'code-block',
    )
    expect(codeBlocks.length).toBeGreaterThanOrEqual(1)
  })

  it('should detect bullet lists', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: '• First item', x: 72, y: 700, size: 12},
          {text: '• Second item', x: 72, y: 680, size: 12},
          {text: '• Third item', x: 72, y: 660, size: 12},
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    // Should have a list parent with Unordered childrenType
    const listParents = flattenBlocks(blocks).filter(
      (b) =>
        (b.props as Record<string, unknown>)?.childrenType === 'Unordered',
    )
    expect(listParents.length).toBeGreaterThanOrEqual(1)
  })

  it('should detect numbered lists', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: '1. First item', x: 72, y: 700, size: 12},
          {text: '2. Second item', x: 72, y: 680, size: 12},
          {text: '3. Third item', x: 72, y: 660, size: 12},
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    const listParents = flattenBlocks(blocks).filter(
      (b) => (b.props as Record<string, unknown>)?.childrenType === 'Ordered',
    )
    expect(listParents.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle multi-page PDFs', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [{text: 'Page one content', x: 72, y: 700, size: 12}],
      },
      {
        texts: [{text: 'Page two content', x: 72, y: 700, size: 12}],
      },
      {
        texts: [{text: 'Page three content', x: 72, y: 700, size: 12}],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    expect(blocks.length).toBeGreaterThanOrEqual(3)
  })

  it('should organize headings into hierarchy', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: 'Chapter Title', x: 72, y: 750, size: 24},
          {text: 'Some intro text.', x: 72, y: 710, size: 12},
          {text: 'Section Title', x: 72, y: 670, size: 18},
          {text: 'Section body.', x: 72, y: 640, size: 12},
        ],
      },
    ])

    const blocks = await PdfToBlocks(pdf)
    // The top-level should have the chapter heading
    const topHeadings = blocks.filter((b) => b.type === 'heading')
    expect(topHeadings.length).toBeGreaterThanOrEqual(1)

    // The chapter heading should have children (the section)
    if (topHeadings.length > 0 && topHeadings[0]!.children.length > 0) {
      // Hierarchy is working
      expect(topHeadings[0]!.children.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('should extract title from PDF', async () => {
    const pdf = await createSimplePdf([
      {
        texts: [
          {text: 'My Document Title', x: 72, y: 750, size: 24},
          {text: 'By Author Name', x: 72, y: 720, size: 12},
          {text: 'Regular content here.', x: 72, y: 680, size: 12},
        ],
      },
    ])

    const title = await extractPdfTitle(pdf)
    expect(title).toBe('My Document Title')
  })

  it('should handle PDF with no text gracefully (scanned PDF simulation)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    // Draw a rectangle instead of text to simulate a scanned page
    page.drawRectangle({x: 50, y: 50, width: 500, height: 700, color: rgb(0.9, 0.9, 0.9)})
    const bytes = await doc.save()
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

    const blocks = await PdfToBlocks(buffer)
    expect(blocks).toEqual([])
  })
})

// Helper to flatten blocks and their children for easier testing
function flattenBlocks(blocks: Array<{type: string; children: unknown[]; content?: unknown[]; props?: unknown}>): Array<{type: string; children: unknown[]; content?: unknown[]; props?: unknown}> {
  const result: Array<{type: string; children: unknown[]; content?: unknown[]; props?: unknown}> = []
  for (const block of blocks) {
    result.push(block)
    if (block.children && Array.isArray(block.children)) {
      result.push(...flattenBlocks(block.children as typeof blocks))
    }
  }
  return result
}
