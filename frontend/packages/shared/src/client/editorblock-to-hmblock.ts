import {EditorBlock, HMInlineContent} from '../editor-types'
import {
  HMAnnotations,
  HMBlock,
  HMBlockButtonAlignmentSchema,
  HMBlockSchema,
  HMBlockType,
  toNumber,
} from '../hm-types'
import {AnnotationSet, codePointLength} from './unicode'

function toHMBlockType(
  editorBlockType: EditorBlock['type'],
): HMBlockType | undefined {
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

export function editorBlockToHMBlock(editorBlock: EditorBlock): HMBlock {
  const blockType = toHMBlockType(editorBlock.type)
  if (!blockType) throw new Error('Unsupported block type ' + editorBlock.type)
  // @ts-expect-error
  let block: HMBlock = {
    id: editorBlock.id,
    type: blockType,
    // @ts-expect-error
    attributes: {} as HMBlock['attributes'],
    text: '',
    annotations: [],
  }

  let leaves = flattenLeaves(editorBlock.content)

  // @ts-expect-error
  block.annotations = [] as HMAnnotations

  if (editorBlock.props.childrenType == 'Group') {
    // @ts-expect-error
    block.attributes.childrenType = 'Group'
  } else if (editorBlock.props.childrenType == 'Unordered') {
    // @ts-expect-error
    block.attributes.childrenType = 'Unordered'
  } else if (editorBlock.props.childrenType == 'Ordered') {
    // @ts-expect-error
    block.attributes.childrenType = 'Ordered'
  } else if (editorBlock.props.childrenType == 'Blockquote') {
    // @ts-expect-error
    block.attributes.childrenType = 'Blockquote'
  }

  // if (parentBlock && editorBlock.props.start) {
  //   parentBlock.attributes.start = editorBlock.props.start.toString()
  // }

  // @ts-expect-error
  block.text = ''

  const annotations = new AnnotationSet()

  let pos = 0
  for (let leaf of leaves) {
    const start = pos
    // TODO: Handle non-text leaves (embed)
    // @ts-expect-error
    const charCount = codePointLength(leaf.text)
    const end = start + charCount

    // @ts-expect-error
    if (leaf.styles?.bold) {
      annotations.addSpan('Bold', null, start, end)
    }

    // @ts-expect-error
    if (leaf.styles?.italic) {
      annotations.addSpan('Italic', null, start, end)
    }

    // @ts-expect-error
    if (leaf.styles?.underline) {
      annotations.addSpan('Underline', null, start, end)
    }

    // @ts-expect-error
    if (leaf.styles?.strike) {
      annotations.addSpan('Strike', null, start, end)
    }

    // @ts-expect-error
    if (leaf.styles?.code) {
      annotations.addSpan('Code', null, start, end)
    }

    // @ts-expect-error
    if (leaf.styles?.math) {
      annotations.addSpan('Math', null, start, end)
    }

    if (leaf.type == 'inline-embed') {
      annotations.addSpan('Embed', {link: leaf.link}, start, end)
    }

    if (leaf.type == 'link') {
      annotations.addSpan('Link', {link: leaf.href}, start, end)
    }

    // @ts-expect-error
    block.text += leaf.text
    pos += charCount
  }

  let outAnnotations = annotations.list()
  if (outAnnotations) {
    // @ts-expect-error
    block.annotations = outAnnotations
  }

  const blockCode = block.type === 'Code' ? block : undefined
  if (blockCode && editorBlock.type == 'code-block') {
    blockCode.attributes!.language = editorBlock.props.language
  }

  const blockImage = block.type === 'Image' ? block : undefined
  if (blockImage && editorBlock.type == 'image') {
    if (editorBlock.props.url) blockImage.link = editorBlock.props.url
    const width = toNumber(editorBlock.props.width)
    if (width) {
      blockImage.attributes.width = width
    }
  }

  const blockVideo = block.type === 'Video' ? block : undefined
  if (blockVideo && editorBlock.type == 'video') {
    blockVideo.text = ''
    if (editorBlock.props.url) blockVideo.link = editorBlock.props.url
    const width = toNumber(editorBlock.props.width)
    if (width) blockVideo.attributes.width = width

    if (editorBlock.props.name) {
      blockVideo.attributes.name = editorBlock.props.name
    }
  }

  const blockFile = block.type === 'File' ? block : undefined
  if (blockFile && editorBlock.type == 'file') {
    if (editorBlock.props.url) blockFile.link = editorBlock.props.url
    if (editorBlock.props.name)
      blockFile.attributes.name = editorBlock.props.name
    const size = toNumber(editorBlock.props.size)
    if (size) blockFile.attributes.size = size
  }

  const blockButton = block.type === 'Button' ? block : undefined
  if (blockButton && editorBlock.type == 'button') {
    if (editorBlock.props.url) blockButton.link = editorBlock.props.url
    if (editorBlock.props.name)
      blockButton.attributes.name = editorBlock.props.name
    if (editorBlock.props.alignment)
      blockButton.attributes.alignment = HMBlockButtonAlignmentSchema.parse(
        editorBlock.props.alignment,
      )
  }

  const blockWebEmbed = block.type === 'WebEmbed' ? block : undefined
  if (
    blockWebEmbed &&
    editorBlock.type == 'web-embed' &&
    editorBlock.props.url
  ) {
    blockWebEmbed.link = editorBlock.props.url
  }

  const blockEmbed = block.type === 'Embed' ? block : undefined
  if (blockEmbed && editorBlock.type == 'embed') {
    // @ts-expect-error
    block.text = '' // for some reason the text was being set to " " but it should be "" according to the schema
    if (editorBlock.props.url) blockEmbed.link = editorBlock.props.url
    if (editorBlock.props.view)
      blockEmbed.attributes.view = editorBlock.props.view
  }

  const blockQuery = block.type === 'Query' ? block : undefined
  if (blockQuery && editorBlock.type == 'query') {
    blockQuery.attributes.style = editorBlock.props.style
    blockQuery.attributes.columnCount = Number(editorBlock.props.columnCount)
    blockQuery.attributes.query = {
      includes: [],
      sort: [],
    }
    if (editorBlock.props.queryIncludes)
      blockQuery.attributes.query.includes = JSON.parse(
        editorBlock.props.queryIncludes,
      )
    if (editorBlock.props.querySort)
      blockQuery.attributes.query.sort = JSON.parse(editorBlock.props.querySort)
    if (editorBlock.props.queryLimit)
      blockQuery.attributes.query.limit = Number(editorBlock.props.queryLimit)
    blockQuery.attributes.banner = editorBlock.props.banner == 'true'
  }

  const blockParse = HMBlockSchema.safeParse(block)

  if (blockParse.success) return block
  console.error('Failed to validate block for writing', block, blockParse.error)
  throw new Error('Failed to validate block for writing ' + blockParse.error)
}

function flattenLeaves(
  content: Array<HMInlineContent>,
): Array<HMInlineContent> {
  let result = []

  for (let i = 0; i < content.length; i++) {
    let leaf = content[i]

    // @ts-expect-error
    if (leaf.type == 'link') {
      // @ts-expect-error
      let nestedLeaves = flattenLeaves(leaf.content).map(
        (l: HMInlineContent) =>
          ({
            ...l,
            // @ts-expect-error
            href: leaf.href,
            type: 'link',
          }) as const,
      )
      result.push(...nestedLeaves)
    }
    // @ts-expect-error
    if (leaf.type == 'inline-embed') {
      result.push({
        ...leaf,
        text: '\uFFFC',
        // @ts-expect-error
        link: leaf.link,
      } as const)
    }

    // @ts-expect-error
    if (leaf.type == 'text') {
      result.push(leaf)
    }
  }

  // @ts-expect-error
  return result
}

function getParentBlock(block: HMBlock) {
  if (block.type == 'Heading') return block
  if (block.type == 'Paragraph') return block
  if (block.type == 'Code') return block
  return undefined
}
