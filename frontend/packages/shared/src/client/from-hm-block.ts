import {
  Block as EditorBlock,
  EditorInlineContent,
  Styles,
  hmBlockSchema,
} from '@shm/desktop/src/editor'
import {Block as ServerBlock} from '@shm/shared/src/client/grpc-types'
import {
  HMAnnotation,
  HMBlock,
  HMBlockChildrenType,
  HMBlockChildrenTypeSchema,
  HMBlockEmbed,
  HMEmbedViewSchema,
  InlineEmbedAnnotation,
} from '../hm-types'

function styleMarkToAnnotationType(
  style: keyof Styles,
): Exclude<HMAnnotation, InlineEmbedAnnotation>['type'] {
  if (style == 'bold') return 'bold'
  if (style == 'italic') return 'italic'
  if (style == 'underline') return 'underline'
  if (style == 'strike') return 'strike'
  if (style == 'code') return 'code'
  throw new Error('Cannot handle this style yet')
}

export function extractContent(content: Array<EditorInlineContent>): {
  annotations: Array<HMAnnotation>
  text: string
} {
  let text = ''
  const annotations: Array<HMAnnotation> = []
  const styleStarts: Record<string, number> = {}
  let charIndex = 0

  content.forEach((inline) => {
    if (inline.type === 'link') {
      const linkContent = extractContent(inline.content)
      const linkLength = linkContent.text.length
      text += linkContent.text
      linkContent.annotations.forEach((annotation) => {
        annotations.push({
          ...annotation,
          starts: annotation.starts.map((start) => start + charIndex),
          ends: annotation.ends.map((end) => end + charIndex),
        })
      })
      annotations.push({
        type: 'link',
        starts: [charIndex],
        ends: [charIndex + linkLength],
        ref: inline.href,
      })
      charIndex += linkLength
    } else {
      if (inline.type == 'inline-embed') {
        const inlineLength = 1
        annotations.push({
          type: 'inline-embed',
          ref: inline.ref,
          starts: [charIndex],
          ends: [charIndex + inlineLength],
        })

        text += ' '
        charIndex++
      } else {
        const inlineLength = inline.text.length

        // Check for style starts
        if ('styles' in inline) {
          const {styles} = inline
          for (const style in styles) {
            if (
              styles[style as keyof Styles] &&
              styleStarts[style] === undefined
            ) {
              styleStarts[style] = charIndex
            }
          }

          // Check for style ends
          for (const style in styleStarts) {
            if (
              styles &&
              !styles[style as keyof Styles] &&
              styleStarts[style] !== undefined
            ) {
              // @ts-expect-error
              annotations.push({
                type: styleMarkToAnnotationType(style as keyof Styles),
                starts: [styleStarts[style]],
                ends: [charIndex],
              })
              delete styleStarts[style]
            }
          }
        }

        text += inline.text
        charIndex += inlineLength
      }
    }
  })

  // Check for any styles that didn't end
  for (const style in styleStarts) {
    if (styleStarts[style] !== undefined) {
      annotations.push({
        type: styleMarkToAnnotationType(style as keyof Styles),
        starts: [styleStarts[style]],
        ends: [charIndex],
      })
    }
  }

  return {text, annotations}
}

export function fromHMBlock(
  editorBlock: EditorBlock<typeof hmBlockSchema>,
): ServerBlock {
  if (!editorBlock.id) throw new Error('this block has no id')

  let res: HMBlock | null = null

  if (editorBlock.type === 'paragraph') {
    res = {
      id: editorBlock.id,
      type: 'paragraph',
      attributes: extractParentAttributes(editorBlock),
      ...extractContent(editorBlock.content),
    }
  }

  if (editorBlock.type === 'heading') {
    res = {
      id: editorBlock.id,
      type: 'heading',
      attributes: extractParentAttributes(editorBlock),
      ...extractContent(editorBlock.content),
    }
  }

  if (editorBlock.type == 'math') {
    res = {
      id: editorBlock.id,
      type: 'math',
      attributes: {},
      ...extractContent(editorBlock.content),
      annotations: [], // todo, replace extractContent with something that will never result in annotations
    } as const
  }

  if (editorBlock.type === 'image') {
    let ref = editorBlock.props.url

    if (ref && !ref?.startsWith('http') && !ref?.startsWith('ipfs://')) {
      ref = `ipfs://${editorBlock.props.url}`
    }

    res = {
      id: editorBlock.id,
      type: 'image',
      attributes: {
        name: editorBlock.props.name,
        width: editorBlock.props.width,
      },
      ref: ref || '',
    } as const
  }

  if (editorBlock.type == 'imagePlaceholder') {
    res = {
      id: editorBlock.id,
      type: 'image',
      attributes: {
        name: editorBlock.props.name,
      },
      ref: '',
    } as const
  }

  if (editorBlock.type === 'file') {
    let ref = editorBlock.props.url

    if (ref && !ref?.startsWith('http') && !ref?.startsWith('ipfs://')) {
      ref = `ipfs://${editorBlock.props.url}`
    }

    res = {
      id: editorBlock.id,
      type: 'file',
      attributes: {
        name: editorBlock.props.name,
        // size: editorBlock.props.size,
      },
      ref: ref || '',
    }
  }

  if (editorBlock.type == 'web-embed') {
    res = {
      id: editorBlock.id,
      type: 'web-embed',
      ref: editorBlock.props.url,
    }
  }

  if (editorBlock.type == 'video') {
    let ref = editorBlock.props.url

    if (ref && !ref?.startsWith('http') && !ref?.startsWith('ipfs://')) {
      ref = `ipfs://${editorBlock.props.url}`
    }
    res = {
      id: editorBlock.id,
      type: 'video',
      attributes: {
        name: editorBlock.props.name,
        width: editorBlock.props.width,
      },
      ref: ref || '',
    }
  }

  if (editorBlock.type == 'embed') {
    const attributes: HMBlockEmbed['attributes'] = {}
    if (editorBlock.props.view) {
      attributes.view = HMEmbedViewSchema.parse(editorBlock.props.view)
    }
    res = {
      id: editorBlock.id,
      type: 'embed',
      ref: editorBlock.props.url,
      text: '',
      annotations: [],
      attributes,
    }
  }

  if (editorBlock.type == 'codeBlock') {
    res = {
      id: editorBlock.id,
      type: 'codeBlock',
      attributes: {
        language: editorBlock.props.language,
        ...extractParentAttributes(editorBlock),
      },
      ...extractContent(editorBlock.content),
      annotations: [], // todo, replace extractContent with something that will never result in annotations
    }
  }

  if (res) {
    // res = extractChildrenType(res, editorBlock)
    // return res
    return new ServerBlock(res)
  }

  throw new Error('not implemented')
}

function extractParentAttributes(
  editorBlock: EditorBlock<typeof hmBlockSchema>,
): {
  childrenType?: HMBlockChildrenType
  start?: string
} {
  const parentAttributes: {
    childrenType?: HMBlockChildrenType
    start?: string
  } = {}
  if (editorBlock.props.childrenType) {
    parentAttributes.childrenType = HMBlockChildrenTypeSchema.parse(
      editorBlock.props.childrenType,
    )
  }
  if (editorBlock.props.start) {
    parentAttributes.start = editorBlock.props.start
  }
  return parentAttributes
}
