import {PlainMessage} from '@bufbuild/protobuf'
import _ from 'lodash'
import {
  EditorBlock,
  EditorBlockProps,
  EditorBlockType,
  EditorInlineEmbed,
  EditorLink,
  EditorText,
  HMInlineContent,
  MediaBlockProps,
} from '../editor-types'
import {
  HMAnnotation,
  HMBlock,
  HMBlockChildrenType,
  HMBlockNode,
  HMBlockType,
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
  return blocks
    .map((hmBlock: PlainMessage<BlockNode> | HMBlockNode) => {
      let res = hmBlock.block
        ? hmBlockToEditorBlock(hmBlock.block as unknown as HMBlock)
        : null

      if (res && hmBlock.children?.length) {
        const childrenType = ((hmBlock.block as any)?.attributes || {})
          ?.childrenType
        // Ensure we only assign valid values to childrenType
        const validChildrenType: HMBlockChildrenType =
          childrenType === 'Group' ||
          childrenType === 'Ordered' ||
          childrenType === 'Unordered' ||
          childrenType === 'Blockquote'
            ? childrenType
            : 'Group'

        res.children = hmBlocksToEditorContent(hmBlock.children, {
          level: childRecursiveOpts.level ? childRecursiveOpts.level + 1 : 1,
          childrenType: validChildrenType,
        })
      }
      return res as EditorBlock
    })
    .filter((block): block is EditorBlock => block !== null)
}

export function hmBlockToEditorBlock(block: HMBlock): EditorBlock {
  const blockType = toEditorBlockType(block.type)

  if (!blockType) throw new Error('Unsupported block type ' + block.type)

  let out: EditorBlock = {
    id: block.id,
    type: blockType,
    content: [],
    props: {
      revision: (block as any).revision,
    },
    children: [],
  } as EditorBlock

  const attributes = (block as any).attributes || {}
  if ('childrenType' in attributes && attributes.childrenType) {
    const childrenType = attributes.childrenType
    // Ensure we only assign valid values to childrenType
    if (
      childrenType === 'Group' ||
      childrenType === 'Ordered' ||
      childrenType === 'Unordered' ||
      childrenType === 'Blockquote'
    ) {
      ;(out.props as EditorBlockProps).childrenType = childrenType
    }
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
    if ((block as any).link) {
      ;(out.props as MediaBlockProps).url = (block as any).link
    }

    if (blockType == 'code-block') {
      out.type = 'code-block'
    }

    if ((block as any).attributes) {
      Object.entries((block as any).attributes).forEach(([key, value]) => {
        if (value !== undefined) {
          if (key == 'width' || key == 'size') {
            if (typeof value == 'number') {
              ;(out.props as any)[key] = String(value)
            }
          } else {
            ;(out.props as any)[key] = value
          }
        }
      })
    }

    // return out
  }

  if (block.type === 'Query') {
    const queryProps = out.props as any
    queryProps.style = block.attributes?.style
    queryProps.columnCount = String(block.attributes?.columnCount || '')
    queryProps.queryIncludes = JSON.stringify(
      block.attributes?.query?.includes || [],
    )
    queryProps.querySort = JSON.stringify(block.attributes?.query?.sort || {})
    queryProps.banner = block.attributes?.banner ? 'true' : 'false'
    queryProps.queryLimit = String(block.attributes?.query?.limit || '')
  }

  const blockText = (block as any).text || ''
  const leaves = out.content

  let leaf: EditorText | null = null

  let inlineBlockContent: HMInlineContent | null = null

  let textStart = 0

  let i = 0

  const stopPoint = (block as any).text ? (block as any).text.length - 1 : 0

  let pos = 0

  const leafAnnotations = new Set<HMAnnotation>()

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
          // @ts-ignore
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
        // @ts-ignore
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
  function startLeaf(posAnnotations: Set<HMAnnotation>) {
    leaf = {
      type: 'text',
      text: '',
      styles: {},
    }

    type CustomAnnotation = {
      type: string
      link?: string
      href?: string
      starts?: number[]
      ends?: number[]
    }

    let linkAnnotation: CustomAnnotation | null = null
    posAnnotations.forEach((l: unknown) => {
      const annotationData = l as CustomAnnotation

      if (annotationData.type === 'Link') {
        linkAnnotation = {
          type: 'Link',
          href: annotationData.link || '',
        }
      }

      if (annotationData.type === 'Embed') {
        linkAnnotation = {
          type: 'Embed',
          link: annotationData.link || '',
        }
      }

      if (
        ['Bold', 'Italic', 'Strike', 'Underline', 'Code', 'Range'].includes(
          annotationData.type,
        )
      ) {
        // @ts-ignore
        leaf.styles[annotationData.type.toLowerCase()] = true
      }

      // if (l.type === 'color') {
      //   // @ts-ignore
      //   leaf.styles['color'] = l.attributes.color
      // }
    })

    if (linkAnnotation) {
      // @ts-expect-error
      if (linkAnnotation.type === 'Embed') {
        leaves.push({
          type: 'inline-embed',
          styles: {},
          // @ts-expect-error
          link: linkAnnotation.link || '',
        } as EditorInlineEmbed)
        textStart = i + 1
      } else if (inlineBlockContent) {
        if (linkChangedIdentity(linkAnnotation as any)) {
          leaves.push(inlineBlockContent)
          // @ts-expect-error
          if (linkAnnotation.type === 'Link') {
            inlineBlockContent = {
              type: 'link',
              content: [],
              // @ts-expect-error
              href: linkAnnotation.href || '',
            } as EditorLink
          } else {
            inlineBlockContent = {
              type: 'inline-embed',
              styles: {},
              // @ts-expect-error
              link: linkAnnotation.link || '',
            } as EditorInlineEmbed
          }
        }
      } else {
        // @ts-expect-error
        if (linkAnnotation.type === 'Link') {
          inlineBlockContent = {
            type: 'link',
            content: [],
            // @ts-expect-error
            href: linkAnnotation.href || '',
          } as EditorLink
        } else {
          inlineBlockContent = {
            type: 'inline-embed',
            styles: {},
            // @ts-expect-error
            link: linkAnnotation.link || '',
          } as EditorInlineEmbed
        }
      }
    } else {
      if (inlineBlockContent) {
        leaves.push(inlineBlockContent)
        inlineBlockContent = null
      }
    }
  }

  function linkChangedIdentity(annotation: any): boolean {
    if (!inlineBlockContent) return false
    let currentLink =
      (inlineBlockContent as any).link ||
      (inlineBlockContent as EditorLink).href
    return currentLink != annotation.link && currentLink != annotation.href
  }

  function finishLeaf(low: number, high: number) {
    let newValue = blockText.substring(low, high)
    if (leaf) (leaf as EditorText).text = newValue

    textStart = high

    if (inlineBlockContent) {
      if (leaf && inlineBlockContent.type == 'link') {
        ;(inlineBlockContent as EditorLink).content.push(leaf)
      } else if (inlineBlockContent.type == 'inline-embed' && leaf) {
        // For inline-embed we just ignore the leaf since it doesn't have content
      } else if (leaf) {
        const typedLeaf: EditorText = {
          type: 'text',
          text: '',
          styles: leaf.styles,
        }
        ;((inlineBlockContent as EditorLink).content as HMInlineContent[]).push(
          typedLeaf,
        )
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
    if (!(block as any).annotations) {
      return false
    }

    // When position matches — we enable the annotation for the current leaf.
    // When it doesn't match — we disable the annotation for the current leaf.
    // @ts-expect-error
    ;(block as any).annotations.forEach((l) => {
      let spanIdx = annotationContains(l as unknown as Annotation, pos)
      if (spanIdx === -1) {
        // If the annotation was in the set, we remove it and mark set as "dirty".
        if (leafAnnotations.delete(l as unknown as HMAnnotation)) {
          annotationsChanged = true
        }
        return
      }

      // If the annotation was already enabled we continue.
      if (leafAnnotations.has(l as unknown as HMAnnotation)) {
        return
      }

      // Whenever we found a new annotation that current position matches,
      // we add it to the set and mark te set as "dirty".
      leafAnnotations.add(l as unknown as HMAnnotation)
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
    // @ts-ignore
    if (annotation.ends[mid] <= pos) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (low == annotation.starts.length) {
    return -1
  }

  // @ts-ignore
  if (annotation.starts[low] <= pos && pos < annotation.ends[low]) {
    return low
  }

  return -1
}

function isText(entry: HMInlineContent): boolean {
  return (
    entry?.type &&
    entry.type == 'text' &&
    typeof (entry as EditorText).text == 'string'
  )
}
