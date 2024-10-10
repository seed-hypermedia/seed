import {EditorBlock, EditorInlineContent} from '@shm/desktop/src/editor'
import {HMAnnotations, HMBlock, HMBlockSchema} from '../hm-types'
import {AnnotationSet, codePointLength} from './unicode'

type HMBlockType = HMBlock['type']

function toHMBlockType(
  editorBlockType: EditorBlock['type'],
): HMBlockType | undefined {
  if (editorBlockType === 'heading') return 'heading'
  if (editorBlockType === 'paragraph') return 'paragraph'
  if (editorBlockType === 'code-block') return 'code'
  if (editorBlockType === 'math') return 'math'
  if (editorBlockType === 'image') return 'image'
  if (editorBlockType === 'video') return 'video'
  if (editorBlockType === 'file') return 'file'
  if (editorBlockType === 'embed') return 'embed'
  if (editorBlockType === 'web-embed') return 'web-embed'
  return undefined
}

export function editorBlockToHMBlock(editorBlock: EditorBlock): HMBlock {
  const blockType = toHMBlockType(editorBlock.type)
  if (!blockType) throw new Error('Unsupported block type ' + editorBlock.type)
  let block: HMBlock = {
    id: editorBlock.id,
    type: blockType,
    attributes: {},
    text: '',
    annotations: [],
  }

  let leaves = flattenLeaves(editorBlock.content)

  block.annotations = [] as HMAnnotations

  const parentBlock = getParentBlock(block)

  if (parentBlock && editorBlock.props.childrenType === 'div') {
    parentBlock.attributes.childrenType = 'group'
  } else if (parentBlock && editorBlock.props.childrenType === 'ul') {
    parentBlock.attributes.childrenType = 'ul'
  } else if (parentBlock && editorBlock.props.childrenType === 'ol') {
    parentBlock.attributes.childrenType = 'ol'
    // } else if (parentBlock && editorBlock.props.childrenType === 'blockquote') {
    //   parentBlock.attributes.childrenType = 'blockquote'
  }
  block.text = ''

  const annotations = new AnnotationSet()

  let pos = 0
  for (let leaf of leaves) {
    const start = pos
    // TODO: Handle non-text leaves (embed)
    const charCount = codePointLength(leaf.text)
    const end = start + charCount

    if (leaf.styles?.bold) {
      annotations.addSpan('bold', null, start, end)
    }

    if (leaf.styles?.italic) {
      annotations.addSpan('italic', null, start, end)
    }

    if (leaf.styles?.underline) {
      annotations.addSpan('underline', null, start, end)
    }

    if (leaf.styles?.strike) {
      annotations.addSpan('strike', null, start, end)
    }

    if (leaf.styles?.code) {
      annotations.addSpan('code', null, start, end)
    }

    if (leaf.styles?.math) {
      annotations.addSpan('math', null, start, end)
    }

    if (leaf.type == 'inline-embed') {
      annotations.addSpan('inline-embed', {ref: leaf.ref}, start, end)
    }

    if (leaf.type == 'link') {
      annotations.addSpan('link', {ref: leaf.href}, start, end)
    }

    block.text += leaf.text
    pos += charCount
  }

  let outAnnotations = annotations.list()
  if (outAnnotations) {
    block.annotations = outAnnotations
  }

  const blockCode = block.type === 'code' ? block : undefined
  if (blockCode && editorBlock.type == 'code-block') {
    blockCode.attributes!.language = editorBlock.props.language
  }

  const blockImage = block.type === 'image' ? block : undefined
  if (blockImage && editorBlock.type == 'image') {
    if (editorBlock.props.url) blockImage.ref = editorBlock.props.url
    if (editorBlock.props.width)
      blockImage.attributes.width = String(editorBlock.props.width)
  }

  const blockVideo = block.type === 'video' ? block : undefined
  if (blockVideo && editorBlock.type == 'video' && editorBlock.props.url) {
    blockVideo.ref = editorBlock.props.url
  }

  const blockFile = block.type === 'file' ? block : undefined
  if (blockFile && editorBlock.type == 'file') {
    if (editorBlock.props.url) blockFile.ref = editorBlock.props.url
    if (editorBlock.props.name)
      blockFile.attributes.name = editorBlock.props.name
    if (editorBlock.props.size)
      blockFile.attributes.size = String(editorBlock.props.size)
  }

  const blockWebEmbed = block.type === 'web-embed' ? block : undefined
  if (
    blockWebEmbed &&
    editorBlock.type == 'web-embed' &&
    editorBlock.props.url
  ) {
    blockWebEmbed.ref = editorBlock.props.url
  }

  const blockEmbed = block.type === 'embed' ? block : undefined
  if (blockEmbed && editorBlock.type == 'embed') {
    block.text = '' // for some reason the text was being set to " " but it should be "" according to the schema
    if (editorBlock.props.url) blockEmbed.ref = editorBlock.props.url
    if (editorBlock.props.view)
      blockEmbed.attributes.view = editorBlock.props.view
  }

  const blockParse = HMBlockSchema.safeParse(block)
  if (blockParse.success) return block
  console.error('Failed to validate block for writing', block, blockParse.error)
  throw new Error('Failed to validate block for writing ' + blockParse.error)
}

function flattenLeaves(
  content: Array<EditorInlineContent>,
): Array<EditorInlineContent> {
  let result = []

  for (let i = 0; i < content.length; i++) {
    let leaf = content[i]

    if (leaf.type == 'link') {
      let nestedLeaves = flattenLeaves(leaf.content).map(
        (l: EditorInlineContent) =>
          ({
            ...l,
            href: leaf.href,
            type: 'link',
          }) as const,
      )
      result.push(...nestedLeaves)
    }
    if (leaf.type == 'inline-embed') {
      result.push({
        ...leaf,
        text: '\uFFFC',
        ref: leaf.ref,
      } as const)
    }

    if (leaf.type == 'text') {
      result.push(leaf)
    }
  }

  return result
}

function getParentBlock(block: HMBlock) {
  if (block.type === 'heading') return block
  if (block.type === 'paragraph') return block
  if (block.type === 'code') return block
  return undefined
}
