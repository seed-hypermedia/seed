import {
  EditorBlock,
  EditorInlineContent,
  MediaBlockProps,
} from '@shm/desktop/src/editor'
import {HMAnnotations, HMBlock} from '../hm-types'
import {AnnotationSet, codePointLength} from './unicode'

export function editorBlockToHMBlock(editorBlock: EditorBlock): HMBlock {
  let out: Partial<HMBlock> = {
    id: editorBlock.id,
    type: editorBlock.type,
    attributes: {},
    annotations: [],
  }

  let leaves = flattenLeaves(editorBlock.content)

  out.annotations = [] as HMAnnotations
  if (editorBlock.props.childrenType) {
    out.attributes!.childrenType = editorBlock.props.childrenType
  }
  out.text = ''

  const annotations = new AnnotationSet()

  let pos = 0
  for (let leaf of leaves) {
    const start = pos
    // TODO: Handle non-text leaves (embed)
    const charCount = codePointLength(leaf.text)
    const end = start + charCount

    if (leaf.styles?.strong) {
      annotations.addSpan('strong', null, start, end)
    }

    if (leaf.styles?.emphasis) {
      annotations.addSpan('emphasis', null, start, end)
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

    if (leaf.styles?.equation) {
      annotations.addSpan('equation', null, start, end)
    }

    if (leaf.type == 'inline-embed') {
      annotations.addSpan('inline-embed', {ref: leaf.ref}, start, end)
    }

    if (leaf.type == 'link') {
      annotations.addSpan('link', {ref: leaf.ref}, start, end)
    }

    out.text += leaf.text
    pos += charCount
  }

  let outAnnotations = annotations.list()
  if (outAnnotations) {
    out.annotations = outAnnotations
  }

  if (editorBlock.type == 'codeBlock') {
    out.attributes!.language = editorBlock.props.language
  }

  if (['image', 'video'].includes(editorBlock.type)) {
    const props = editorBlock.props as MediaBlockProps
    out.ref = props.url
    if (!out.attributes) {
      out.attributes = {}
    }
    if (props.name) {
      out.attributes.name = props.name
    }
    if (props.size) {
      out.attributes.size = props.size
    }
    if (props.width) {
      out.attributes.width = props.width.toString()
    }
    if (props.defaultOpen) {
      out.attributes.defaultOpen = props.defaultOpen
    }
    if (props.src) {
      out.attributes.src = props.src
    }
  }

  return out as HMBlock
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
          ref: leaf.ref,
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
