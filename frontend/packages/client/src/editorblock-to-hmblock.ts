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
  return undefined
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

/** Convert a single BlockNote EditorBlock into an HMBlock. */
export function editorBlockToHMBlock(editorBlock: EditorBlock): HMBlock {
  const blockType = toHMBlockType(editorBlock.type)
  if (!blockType) throw new Error('Unsupported block type ' + editorBlock.type)

  let block: MutableBlock = {
    id: editorBlock.id,
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
    const width = toNumber(editorBlock.props.width)
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
