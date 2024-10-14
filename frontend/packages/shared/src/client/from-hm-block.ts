import {
  Block as EditorBlock,
  EditorInlineContent,
  Styles,
  hmBlockSchema,
} from '@shm/desktop/src/editor'
import {
  HMAnnotation,
  HMBlockChildrenType,
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
        type: 'Link',
        starts: [charIndex],
        ends: [charIndex + linkLength],
        link: inline.href,
      })
      charIndex += linkLength
    } else {
      if (inline.type == 'inline-embed') {
        const inlineLength = 1
        annotations.push({
          type: 'Embed',
          link: inline.link,
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

function getHMBlockChildrenType(editorChildrenType: string) {
  if (editorChildrenType == 'ul') return 'ul'
  if (editorChildrenType == 'ol') return 'ol'
  if (editorChildrenType == 'blockquote') return 'blockquote'
  if (editorChildrenType == 'group') return 'group'
  if (editorChildrenType == 'div') return 'group' // not sure why this inconsistency exists
  return undefined
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
    parentAttributes.childrenType = getHMBlockChildrenType(
      editorBlock.props.childrenType,
    )
  }
  if (editorBlock.props.start) {
    parentAttributes.start = editorBlock.props.start
  }
  return parentAttributes
}
