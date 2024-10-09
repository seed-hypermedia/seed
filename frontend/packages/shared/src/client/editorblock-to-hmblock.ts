import {EditorBlock, EditorInlineContent} from '@shm/desktop/src/editor'
import {HMAnnotations, HMBlock, HMBlockSchema} from '../hm-types'
import {AnnotationSet, codePointLength} from './unicode'

export function editorBlockToHMBlock(editorBlock: EditorBlock): HMBlock {
  let block: HMBlock = {
    id: editorBlock.id,
    type: editorBlock.type,
    attributes: {},
    text: '',
    annotations: [],
  }

  let leaves = flattenLeaves(editorBlock.content)

  block.annotations = [] as HMAnnotations
  if (editorBlock.props.childrenType) {
    block.attributes!.childrenType = editorBlock.props.childrenType
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

  if (editorBlock.type == 'codeBlock') {
    block.attributes!.language = editorBlock.props.language
  }

  if (
    ['image', 'video', 'file', 'embed', 'web-embed', 'nostr'].includes(
      editorBlock.type,
    )
  ) {
    block.ref = editorBlock.props.url!
  }

  // Dynamically add all properties from props to block.attributes
  Object.entries(editorBlock.props).forEach(([key, value]) => {
    if (value !== undefined && key !== 'url' && key !== 'ref') {
      block.attributes![key] =
        typeof value === 'number' ? value.toString() : value
    }
  })

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
        (l: EditorInlineContent) => ({
          ...l,
          href: leaf.href,
          type: 'link',
        }),
      )
      result.push(...nestedLeaves)
    }
    if (leaf.type == 'inline-embed') {
      result.push({
        ...leaf,
        text: '\uFFFC',
        ref: leaf.ref,
      })
    }

    if (leaf.type == 'text') {
      result.push(leaf)
    }
  }

  return result
}
