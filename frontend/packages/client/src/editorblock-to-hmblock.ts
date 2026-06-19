import type {EditorBlock, HMInlineContent} from './editor-types'
import {
  type HMAnnotations,
  type HMBlock,
  HMBlockButtonAlignmentSchema,
  type HMBlockNode,
  HMBlockSchema,
  type HMBlockType,
  toNumber,
} from './hm-types'
import {AnnotationSet, codePointLength} from './unicode'

function toHMBlockType(editorBlockType: EditorBlock['type']): HMBlockType | undefined {
  if (editorBlockType === 'heading') return 'Heading'
  if (editorBlockType === 'paragraph') return 'Paragraph'
  if (editorBlockType === 'code-block') return 'Code'
  if (editorBlockType === 'math') return 'Math'
  if (editorBlockType === 'image') return 'Image'
  if (editorBlockType === 'video') return 'Video'
  if (editorBlockType === 'file') return 'File'
  if (editorBlockType === 'button') return 'Button'
  if (editorBlockType === 'embed') return 'Embed'
  if (editorBlockType === 'web-embed') return 'WebEmbed'
  if (editorBlockType === 'query') return 'Query'
  if (editorBlockType === 'table') return 'Table'
  if (editorBlockType === 'tableRow') return 'TableRow'
  if (editorBlockType === 'tableColumn') return 'TableColumn'
  return undefined
}

function toImageWidthNumber(width: string | undefined): number | null {
  if (width?.trim().endsWith('%')) {
    const percentage = Number(width.trim().slice(0, -1))
    return Number.isFinite(percentage) && percentage > 0 ? percentage : null
  }
  return toNumber(width)
}

// Mutable block type for building HMBlock before validation
type MutableBlock = {
  id: string
  type: HMBlockType
  text: string
  link?: string
  annotations: HMAnnotations
  attributes: Record<string, unknown>
}

/**
 * Reconstruct the original HMBlock for an unknown/unsupported editor block.
 *
 * Unknown blocks carry their untouched server representation (JSON-stringified)
 * in `props.originalData`. We round-trip that verbatim so corrupt blocks — or
 * blocks of a type this client version simply doesn't understand yet — survive
 * an edit/publish cycle without being mutated or dropped. The block `id` is
 * taken from the editor block so it stays in sync if it was regenerated during
 * de-duplication.
 */
function unknownEditorBlockToHMBlock(editorBlock: EditorBlock): HMBlock {
  const props = (editorBlock.props ?? {}) as {originalData?: string; originalType?: string}

  if (props.originalData) {
    try {
      const parsed = JSON.parse(props.originalData)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {...parsed, id: editorBlock.id} as unknown as HMBlock
      }
    } catch {
      // Unparseable original data — fall through to a minimal reconstruction.
    }
  }

  // No recoverable original data: emit a minimal block that still preserves the
  // original type string so nothing downstream crashes.
  return {
    id: editorBlock.id,
    type: props.originalType || 'unknown',
    text: '',
    annotations: [],
    attributes: {},
  } as unknown as HMBlock
}

/** Convert a single BlockNote EditorBlock into an HMBlock. */
export function editorBlockToHMBlock(editorBlock: EditorBlock): HMBlock {
  // Unknown blocks are preserved as-is from their original server data.
  if (editorBlock.type === 'unknown') {
    return unknownEditorBlockToHMBlock(editorBlock)
  }

  const blockType = toHMBlockType(editorBlock.type)
  if (!blockType) throw new Error('Unsupported block type ' + editorBlock.type)

  let block: MutableBlock = {
    id: normalizeEditorBlockId(editorBlock.id),
    type: blockType,
    attributes: {},
    text: '',
    annotations: [],
  }

  let leaves = flattenLeaves(editorBlock.content)

  if (editorBlock.props.childrenType == 'Group') {
    block.attributes.childrenType = 'Group'
  } else if (editorBlock.props.childrenType == 'Unordered') {
    block.attributes.childrenType = 'Unordered'
  } else if (editorBlock.props.childrenType == 'Ordered') {
    block.attributes.childrenType = 'Ordered'
  } else if (editorBlock.props.childrenType == 'Blockquote') {
    block.attributes.childrenType = 'Blockquote'
  } else if (editorBlock.props.childrenType == 'Grid') {
    block.attributes.childrenType = 'Grid'
    if (editorBlock.props.columnCount) {
      block.attributes.columnCount = Number(editorBlock.props.columnCount)
    }
  }

  // if (parentBlock && editorBlock.props.start) {
  //   parentBlock.attributes.start = editorBlock.props.start.toString()
  // }

  const annotations = new AnnotationSet()

  // Type for flattened leaves which all have text property
  type FlattenedLeaf = {
    type: 'text' | 'link' | 'inline-embed'
    text: string
    styles?: {
      bold?: boolean
      italic?: boolean
      underline?: boolean
      strike?: boolean
      code?: boolean
      math?: boolean
      textColor?: string
      backgroundColor?: string
      textSize?: string
      textFamily?: string
    }
    href?: string
    link?: string
  }

  let pos = 0
  for (let leaf of leaves as FlattenedLeaf[]) {
    const start = pos
    // TODO: Handle non-text leaves (embed)
    const charCount = codePointLength(leaf.text)
    const end = start + charCount

    if (leaf.styles?.bold) {
      annotations.addSpan('Bold', null, start, end)
    }

    if (leaf.styles?.italic) {
      annotations.addSpan('Italic', null, start, end)
    }

    if (leaf.styles?.underline) {
      annotations.addSpan('Underline', null, start, end)
    }

    if (leaf.styles?.strike) {
      annotations.addSpan('Strike', null, start, end)
    }

    if (leaf.styles?.code) {
      annotations.addSpan('Code', null, start, end)
    }

    if (leaf.styles?.math) {
      annotations.addSpan('Math', null, start, end)
    }

    if (leaf.type == 'inline-embed') {
      annotations.addSpan('Embed', {link: leaf.link!}, start, end)
    }

    if (leaf.type == 'link') {
      annotations.addSpan('Link', {link: leaf.href!}, start, end)
    }

    if (leaf.styles?.textColor) {
      annotations.addSpan('TextColor', {value: leaf.styles.textColor}, start, end)
    }

    if (leaf.styles?.backgroundColor) {
      annotations.addSpan('BackgroundColor', {value: leaf.styles.backgroundColor}, start, end)
    }

    if (leaf.styles?.textSize) {
      annotations.addSpan('TextSize', {value: leaf.styles.textSize}, start, end)
    }

    if (leaf.styles?.textFamily) {
      annotations.addSpan('TextFamily', {value: leaf.styles.textFamily}, start, end)
    }

    block.text += leaf.text
    pos += charCount
  }

  let outAnnotations = annotations.list()
  if (outAnnotations) {
    block.annotations = outAnnotations
  }

  const blockCode = block.type === 'Code' ? block : undefined
  if (blockCode && editorBlock.type == 'code-block') {
    blockCode.attributes.language = editorBlock.props.language
  }

  const blockImage = block.type === 'Image' ? block : undefined
  if (blockImage && editorBlock.type == 'image') {
    if (editorBlock.props.url && !editorBlock.props.mediaRef) {
      blockImage.link = editorBlock.props.url
    } else if (editorBlock.props.mediaRef) {
      // mediaRef means draft media in IndexedDB — don't store blob URL in link
      blockImage.link = ''
    } else if (editorBlock.props.displaySrc) {
      blockImage.link = editorBlock.props.displaySrc
    } else if (editorBlock.props.src) {
      blockImage.link = editorBlock.props.src
    } else {
      blockImage.link = ''
    }
    const width = toImageWidthNumber(editorBlock.props.width)
    if (width) {
      blockImage.attributes.width = width
    }
  }

  const blockVideo = block.type === 'Video' ? block : undefined
  if (blockVideo && editorBlock.type == 'video') {
    blockVideo.text = ''
    if (editorBlock.props.url && !editorBlock.props.mediaRef) {
      blockVideo.link = editorBlock.props.url
    } else if (editorBlock.props.mediaRef) {
      blockVideo.link = ''
    }
    const width = toNumber(editorBlock.props.width)
    if (width) blockVideo.attributes.width = width

    if (editorBlock.props.name) {
      blockVideo.attributes.name = editorBlock.props.name
    }
    if (editorBlock.props.autoplay === 'true') {
      blockVideo.attributes.autoplay = true
    }
    if (editorBlock.props.loop === 'true') {
      blockVideo.attributes.loop = true
    }
    if (editorBlock.props.muted === 'true') {
      blockVideo.attributes.muted = true
    }
  }

  const blockFile = block.type === 'File' ? block : undefined
  if (blockFile && editorBlock.type == 'file') {
    if (editorBlock.props.url && !editorBlock.props.mediaRef) {
      blockFile.link = editorBlock.props.url
    } else if (editorBlock.props.mediaRef) {
      blockFile.link = ''
    }
    if (editorBlock.props.name) blockFile.attributes.name = editorBlock.props.name
    const size = toNumber(editorBlock.props.size)
    if (size) blockFile.attributes.size = size
  }

  const blockButton = block.type === 'Button' ? block : undefined
  if (blockButton && editorBlock.type == 'button') {
    if (editorBlock.props.url) blockButton.link = editorBlock.props.url
    if (editorBlock.props.name) blockButton.attributes.name = editorBlock.props.name
    if (editorBlock.props.alignment)
      blockButton.attributes.alignment = HMBlockButtonAlignmentSchema.parse(editorBlock.props.alignment)
  }

  const blockWebEmbed = block.type === 'WebEmbed' ? block : undefined
  if (blockWebEmbed && editorBlock.type == 'web-embed' && editorBlock.props.url) {
    blockWebEmbed.link = editorBlock.props.url
  }

  const blockEmbed = block.type === 'Embed' ? block : undefined
  if (blockEmbed && editorBlock.type == 'embed') {
    block.text = '' // for some reason the text was being set to " " but it should be "" according to the schema
    if (editorBlock.props.url) blockEmbed.link = editorBlock.props.url
    if (editorBlock.props.view) blockEmbed.attributes.view = editorBlock.props.view
  }

  const blockParagraph = block.type === 'Paragraph' ? block : undefined
  if (blockParagraph && editorBlock.type == 'paragraph') {
    // A Paragraph that lives inside a TableRow carries a columnId pointing at
    // its TableColumn.
    if (editorBlock.props.columnId) {
      blockParagraph.attributes.columnId = editorBlock.props.columnId
    }
  }

  const blockTable = block.type === 'Table' ? block : undefined
  if (blockTable && editorBlock.type == 'table') {
    // Tables hold no own text. Defensive normalisation in case the editor surfaced any.
    blockTable.text = ''
  }

  const blockTableRow = block.type === 'TableRow' ? block : undefined
  if (blockTableRow && editorBlock.type == 'tableRow') {
    blockTableRow.text = ''
    if (editorBlock.props.isHeader) blockTableRow.attributes.isHeader = true
  }

  const blockTableColumn = block.type === 'TableColumn' ? block : undefined
  if (blockTableColumn && editorBlock.type == 'tableColumn') {
    blockTableColumn.text = ''
    const width = toNumber(editorBlock.props.width)
    if (width) blockTableColumn.attributes.width = width
    if (editorBlock.props.isHeader) blockTableColumn.attributes.isHeader = true
  }

  const blockQuery = block.type === 'Query' ? block : undefined
  if (blockQuery && editorBlock.type == 'query') {
    blockQuery.attributes.style = editorBlock.props.style
    blockQuery.attributes.columnCount = Number(editorBlock.props.columnCount)
    const query: {includes: unknown[]; sort: unknown[]; limit?: number} = {
      includes: [],
      sort: [],
    }
    if (editorBlock.props.queryIncludes) query.includes = JSON.parse(editorBlock.props.queryIncludes)
    if (editorBlock.props.querySort) query.sort = JSON.parse(editorBlock.props.querySort)
    if (editorBlock.props.queryLimit) query.limit = Number(editorBlock.props.queryLimit)
    blockQuery.attributes.query = query
    blockQuery.attributes.banner = editorBlock.props.banner == 'true'
  }

  const blockParse = HMBlockSchema.safeParse(block)

  if (blockParse.success) {
    return blockParse.data as HMBlock
  }

  // TypeScript can't narrow the type here, so we need to assert it
  const failedParse = blockParse as {success: false; error: any}
  console.error('Failed to validate block for writing', block, failedParse.error)
  throw new Error('Failed to validate block for writing ' + JSON.stringify(failedParse.error))
}

/**
 * Convert an array of BlockNote EditorBlocks into an HMBlockNode tree.
 *
 * This is the tree-level wrapper around `editorBlockToHMBlock` that recursively
 * converts children. Useful when serializing editor content to the HM block format
 * (e.g. for saving drafts as markdown or publishing documents).
 */
export function editorBlocksToHMBlockNodes(editorBlocks: EditorBlock[]): HMBlockNode[] {
  return editorBlocks
    .map((block) => {
      try {
        return {
          block: editorBlockToHMBlock(block),
          children: block.children?.length ? editorBlocksToHMBlockNodes(block.children) : undefined,
        }
      } catch {
        return {
          block: {
            id: block.id || 'unknown',
            type: 'Paragraph' as const,
            text: `[Unsupported block type: ${block.type}]`,
            annotations: [],
            attributes: {},
          },
          children: block.children?.length ? editorBlocksToHMBlockNodes(block.children) : undefined,
        }
      }
    })
    .filter(Boolean) as HMBlockNode[]
}

function flattenLeaves(content: Array<HMInlineContent>): Array<HMInlineContent> {
  let result: HMInlineContent[] = []

  for (let i = 0; i < content.length; i++) {
    const leaf = content[i]
    if (!leaf) continue

    if (leaf.type == 'link') {
      let nestedLeaves = flattenLeaves(leaf.content).map(
        (l: HMInlineContent) =>
          ({
            ...l,
            href: leaf.href,
            type: 'link',
          }) as HMInlineContent,
      )
      result.push(...nestedLeaves)
    }

    if (leaf.type == 'inline-embed') {
      result.push({
        ...leaf,
        text: '\uFFFC',
        link: leaf.link,
      } as unknown as HMInlineContent)
    }

    if (leaf.type == 'text') {
      result.push(leaf)
    }
  }

  return result
}

function normalizeEditorBlockId(id: string | undefined): string {
  return id && id !== 'empty' ? id : generateBlockId()
}

function generateBlockId(length: number = 8): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}
