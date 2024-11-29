import {PlainMessage} from '@bufbuild/protobuf'
import _ from 'lodash'
import {
  EditorBlock,
  EditorBlockType,
  EditorInlineContent,
  EditorInlineEmbed,
} from '../editor-types'
import {
  HMBlock,
  HMBlockChildrenType,
  HMBlockNode,
  HMBlockType,
  InlineEmbedAnnotation,
  LinkAnnotation,
} from '../hm-types'
import {
  Annotation,
  BlockNode,
} from './.generated/documents/v3alpha/documents_pb'
import {isSurrogate} from './unicode'

type ServerToEditorRecursiveOpts = {
  level?: number
}

function toEditorBlockType(
  hmBlockType: HMBlockType,
): EditorBlockType | undefined {
  if (hmBlockType === 'Heading') return 'heading'
  if (hmBlockType === 'Paragraph') return 'paragraph'
  if (hmBlockType === 'Code') return 'code-block'
  if (hmBlockType === 'Math') return 'math'
  if (hmBlockType === 'Image') return 'image'
  if (hmBlockType === 'Video') return 'video'
  if (hmBlockType === 'File') return 'file'
  if (hmBlockType === 'Button') return 'button'
  if (hmBlockType === 'Embed') return 'embed'
  if (hmBlockType === 'WebEmbed') return 'web-embed'
  if (hmBlockType === 'Nostr') return 'nostr'
  if (hmBlockType === 'Query') return 'query'
  return undefined
}

export function hmBlocksToEditorContent(
  blocks: Array<PlainMessage<BlockNode> | HMBlockNode>,
  opts: ServerToEditorRecursiveOpts & {
    childrenType?: HMBlockChildrenType
    listLevel?: string
    start?: string
  } = {level: 1},
): Array<EditorBlock> {
  const childRecursiveOpts: ServerToEditorRecursiveOpts = {
    level: opts.level || 0,
  }
  return blocks.map((hmBlock: PlainMessage<BlockNode> | HMBlockNode) => {
    let res: EditorBlock | null = hmBlock.block
      ? hmBlockToEditorBlock(hmBlock.block)
      : null

    if (hmBlock.children?.length) {
      res.children = hmBlocksToEditorContent(hmBlock.children, {
        level: childRecursiveOpts.level ? childRecursiveOpts.level + 1 : 1,
        // @ts-expect-error the type {} prevents childrenType from being set
        childrenType: hmBlock.block?.attributes?.childrenType || 'Group',
      })
    }
    return res
  })
}

export function hmBlockToEditorBlock(block: HMBlock): EditorBlock {
  const blockType = toEditorBlockType(block.type)
  if (!blockType) throw new Error('Unsupported block type ' + block.type)

  let out: EditorBlock = {
    id: block.id,
    type: blockType,
    content: [],
    props: {
      revision: block.revision,
    },
    children: [],
  }

  // @ts-expect-error the type {} prevents childrenType from being set
  if (block.attributes?.childrenType) {
    out.props.childrenType = block.attributes.childrenType
  }

  // if (block.attributes?.start) {
  //   out.props.start =
  //     typeof block.attributes.start == 'number'
  //       ? block.attributes.start.toString()
  //       : block.attributes.start
  // }

  if (
    [
      'code-block',
      'video',
      'image',
      'file',
      'button',
      'embed',
      'web-embed',
      'math',
      'nostr',
    ].includes(blockType)
  ) {
    if (block.link) {
      out.props.url = block.link
    }

    if (blockType == 'code-block') {
      out.type = 'code-block'
    }

    Object.entries(block.attributes).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key == 'width' || key == 'size') {
          if (typeof value == 'number') {
            out.props![key] = String(value)
          }
        } else {
          out.props![key] = value
        }
      }
    })

    // return out
  }

  if (block.type === 'Query') {
    out.props.style = block.attributes.style
    out.props.columnCount = String(block.attributes.columnCount)
    out.props.queryIncludes = JSON.stringify(block.attributes.query.includes)
    out.props.querySort = JSON.stringify(block.attributes.query.sort)
  }

  const blockText = block.text || ''
  const leaves = out.content

  let leaf: EditorInlineContent | null = null

  let inlineBlockContent: EditorInlineContent | null = null

  let textStart = 0

  let i = 0

  const stopPoint = block.text ? block.text.length - 1 : 0

  let pos = 0

  const leafAnnotations = new Set<Annotation>()

  if (blockText == '') {
    leaves.push({type: 'text', text: blockText, styles: {}})
    return out
  }

  while (i < blockText.length) {
    let ul = 1

    let annotationsChanged = trackPosAnnotations(pos)

    let surrogate = isSurrogate(blockText, i)

    if (surrogate) {
      ul++

      let onlyOneSurrogate = pos + ul
      if (onlyOneSurrogate == blockText.length) {
        if (!leaf) {
          startLeaf(leafAnnotations)
        }

        finishLeaf(textStart, i + 2)

        if (inlineBlockContent) {
          if (!isText(leaves[leaves.length - 1])) {
            // leaves.push({type: 'text', text: '', styles: {}})
          }

          leaves.push(inlineBlockContent)
          //   leaves.push({type: 'text', text: '', styles: {}})
          inlineBlockContent = null
        }
        return out
      }
    }

    if (stopPoint < 0) {
      console.warn('STOP IS LESS THAN ZERO', block)
    }

    if (i == stopPoint) {
      if (annotationsChanged) {
        if (leaf) {
          finishLeaf(textStart, i)
        }
        startLeaf(leafAnnotations)
      } else {
        startLeaf(leafAnnotations)
      }

      finishLeaf(textStart, i + 1)

      if (inlineBlockContent) {
        if (!isText(leaves[leaves.length - 1])) {
          //   leaves.push({type: 'text', text: '', styles: {}})
        }
        leaves.push(inlineBlockContent)
        // leaves.push({type: 'text', text: '', styles: {}})
        inlineBlockContent = null
      }

      return out
    }

    // On the first iteration we won't have the leaf.
    if (!leaf) {
      startLeaf(leafAnnotations)
      advance(ul)
      continue
    }

    // When annotations change we need to finish the current leaf and start the new one.
    if (annotationsChanged) {
      finishLeaf(textStart, i)
      startLeaf(leafAnnotations)
    }

    advance(ul)

    // we check here if the new value of `i` is the same as the text's block length.
    // This means that th last character is Surrogate, and we just finished the transformation
    if (i == blockText.length) {
      finishLeaf(textStart, i)
      return out
    }
  }

  // We should never get here, because we would returned when we reach the stop point.
  throw Error('BUG: should not get here')

  // Advances our position. Used after every iteration.
  // Accepts the number of code units to advance the UTF-16 position.
  // Mostly it is 1, but for surrogate pairs it's 2.
  function advance(codeUnits: number) {
    pos++
    i += codeUnits
  }

  // Creates a new leaf, and makes it current.
  // Uses annotations current position belongs to.
  function startLeaf(posAnnotations: Set<Annotation>) {
    leaf = {
      type: 'text',
      text: '',
      styles: {},
    }

    let linkAnnotation: LinkAnnotation | InlineEmbedAnnotation | null = null

    posAnnotations.forEach((l) => {
      // if (['Link', 'Embed'].includes(l.type)) {
      //   linkAnnotation = l as LinkAnnotation | InlineEmbedAnnotation
      // }
      if (l.type == 'Link') {
        linkAnnotation = {
          type: 'link',
          href: l.link,
        }
      }

      if (l.type == 'Embed') {
        linkAnnotation = {
          type: 'inline-embed',
          name: l.attributes.name,
          link: l.link,
        }
      }
      if (['Bold', 'Italic', 'Strike', 'Underline', 'Code'].includes(l.type)) {
        // @ts-ignore
        leaf.styles[l.type.toLowerCase()] = true
      }

      // if (l.type === 'color') {
      //   // @ts-ignore
      //   leaf.styles['color'] = l.attributes.color
      // }
    })

    if (linkAnnotation) {
      if (linkAnnotation.type === 'inline-embed') {
        leaves.push({
          type: 'inline-embed',
          styles: {},
          name: linkAnnotation.attributes.name,
          link: linkAnnotation.link,
        } as EditorInlineEmbed)
        textStart = i + 1
      } else if (inlineBlockContent) {
        if (linkChangedIdentity(linkAnnotation)) {
          leaves.push(inlineBlockContent)
          inlineBlockContent = {
            type: linkAnnotation.type,
            content: [],
          }

          if (linkAnnotation.type == 'link') {
            inlineBlockContent.href = linkAnnotation.href
          } else if (linkAnnotation.type == 'inline-embed') {
            inlineBlockContent.link = linkAnnotation.link
          }
        }
      } else {
        inlineBlockContent = {
          type: linkAnnotation.type,
          content: [],
        }
        if (linkAnnotation.type == 'link') {
          inlineBlockContent.href = linkAnnotation.href
        } else if (linkAnnotation.type == 'inline-embed') {
          inlineBlockContent.link = linkAnnotation.link
        }
      }
    } else {
      if (inlineBlockContent) {
        leaves.push(inlineBlockContent)
        inlineBlockContent = null
      }
    }
  }

  function linkChangedIdentity(annotation: Annotation): boolean {
    if (!inlineBlockContent) return false
    let currentLink = inlineBlockContent.link
    return currentLink != annotation.link
  }

  function finishLeaf(low: number, high: number) {
    let newValue = blockText.substring(low, high)
    if (leaf) leaf.text = newValue

    textStart = high

    if (inlineBlockContent) {
      if (leaf && inlineBlockContent.type == 'link') {
        inlineBlockContent.content.push(leaf)
      } else {
        inlineBlockContent.content.push({...leaf, text: ''})
      }
    } else {
      if (leaf && !_.isEqual(leaf, {type: 'text', text: '', styles: {}})) {
        leaves.push(leaf)
      }
    }
  }

  function trackPosAnnotations(pos: number): boolean {
    // Whenever we detect that annotations of the current position are not the same as the ones for
    // the previous position, we change this to true, and use it to start a new leaf later.
    let annotationsChanged = false

    // early return if annotations does not exist
    if (!block.annotations) return false

    // When position matches — we enable the annotation for the current leaf.
    // When it doesn't match — we disable the annotation for the current leaf.
    block.annotations.forEach((l) => {
      let spanIdx = annotationContains(l, pos)
      if (spanIdx === -1) {
        // If the annotation was in the set, we remove it and mark set as "dirty".
        if (leafAnnotations.delete(l)) {
          annotationsChanged = true
        }
        return
      }

      // If the annotation was already enabled we continue.
      if (leafAnnotations.has(l)) {
        return
      }

      // Whenever we found a new annotation that current position matches,
      // we add it to the set and mark te set as "dirty".
      leafAnnotations.add(l)
      annotationsChanged = true
    })

    return annotationsChanged
  }
}

// Checks if a position expressed in code points is within any of the span
// of this annotation.
// It assumes starts and ends array are valid span values, and are sorted,
// because it's implemented as a binary search.
// It returns array index of the span the position matches.
// Otherwise it returns -1.
export function annotationContains(
  annotation: Annotation,
  pos: number,
): number {
  let low = 0
  let high = annotation.starts.length - 1
  let mid = 0

  while (low <= high) {
    mid = Math.floor((low + high) / 2)
    // Binary search. If the midpoint span ends before the position
    // we're checking — we drop the left side of the array entirely.
    if (annotation.ends[mid] <= pos) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (low == annotation.starts.length) {
    return -1
  }

  if (annotation.starts[low] <= pos && pos < annotation.ends[low]) {
    return low
  }

  return -1
}

function isText(entry: EditorInlineContent): boolean {
  return entry?.type && entry.type == 'text' && typeof entry.text == 'string'
}
