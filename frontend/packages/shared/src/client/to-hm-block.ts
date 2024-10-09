import {BNLink, EditorInlineContent, InlineEmbed} from '@shm/desktop/src/editor'
import {
  EditorTextStyles,
  HMAnnotation,
  HMAnnotations,
  HMBlock,
} from '../hm-types'
import {Annotation} from './.generated/documents/v3alpha/documents_pb'

function areStylesEqual(
  styles1: InternalAnnotation | null,
  styles2: InternalAnnotation | null,
  keys: Set<string>,
): boolean {
  if (styles1 === null && styles2 === null) return true
  if (styles1 === null || styles2 === null) return false

  for (let key of keys) {
    if (styles1[key] !== styles2[key]) {
      return false
    }
  }

  return true
}

type InternalAnnotation = Record<string, string | boolean>

function annotationStyle(a: HMAnnotation): EditorTextStyles {
  const annotation = a
  if (annotation.type == 'italic') {
    return {italic: true}
  }
  if (annotation.type == 'bold') {
    return {bold: true}
  }
  if (annotation.type == 'underline') {
    return {underline: true}
  }
  if (annotation.type == 'strike') {
    return {strike: true}
  }
  if (annotation.type == 'code') {
    return {code: true}
  }

  // if (annotation.type === 'embed') {
  //   return {embed: annotation.ref}
  // }
  return {}
}

export function toEditorInlineContent(
  block: Partial<HMBlock>,
): Array<EditorInlineContent> {
  const linkEmbedAndRangeAnnotations = block.annotations?.filter(
    (a) => a.type == 'link' || a.type == 'inline-embed' || a.type == 'range',
  )
  if (!linkEmbedAndRangeAnnotations?.length) {
    return partialBlockToStyledText(block)
  }

  // link annotations
  // link, embed, and range annotations
  if (
    linkEmbedAndRangeAnnotations.find((a) => {
      if (a.starts.length !== 1) return true
      if (a.ends.length !== 1) return true
    })
  ) {
    throw new Error(
      'Invalid link, embed, or range annotations in this block. Only one range per annotation is allowed',
    )
  }
  const sortedAnnotations = linkEmbedAndRangeAnnotations.sort(
    (a, b) => a.starts[0] - b.starts[0],
  )

  function getSlicedContent(start: number, end: number) {
    return partialBlockToStyledText({
      text: block.text.slice(start, end),
      annotations: block.annotations.map((a) => {
        return new Annotation({
          ...a,
          starts: a.starts.map((s) => s - start),
          ends: a.ends.map((e) => e - start),
        })
      }),
    })
  }

  let annotationStart = sortedAnnotations[0].starts[0]
  const inlines: Array<EditorInlineContent> = []
  inlines.push(...getSlicedContent(0, annotationStart))

  sortedAnnotations.forEach((a, aIndex) => {
    const length = a.ends[0] - a.starts[0]
    const annotationEnd = annotationStart + length

    if (a.type == 'link' || a.type == 'range') {
      inlines.push({
        type: a.type,
        href: a.ref,
        content: getSlicedContent(annotationStart, annotationEnd),
      } as BNLink)
    } else if (a.type == 'inline-embed') {
      inlines.push({
        type: a.type,
        ref: a.ref,
      } as InlineEmbed)
    }

    const nonAnnotationContentEnd =
      sortedAnnotations[aIndex + 1]?.starts[0] || block.text.length
    inlines.push(...getSlicedContent(annotationEnd, nonAnnotationContentEnd))

    annotationStart = nonAnnotationContentEnd
  })
  return inlines
}

export function partialBlockToStyledText({
  text,
  annotations,
}: {
  text: string
  annotations: HMAnnotations
}) {
  if (!text) text = ''
  const stylesForIndex: (InternalAnnotation | null)[] = Array(text.length).fill(
    null,
  )
  const inlines: EditorTextStyles[] = []
  const allStyleKeys = new Set<string>()

  annotations?.forEach((annotation) => {
    const {starts, ends} = annotation
    const annotationStyles = annotationStyle(annotation)
    Object.keys(annotationStyles).forEach((key) => allStyleKeys.add(key))
    starts.forEach((start, index) => {
      const end = ends[index]
      for (let i = start; i < end; i++) {
        stylesForIndex[i] = {
          ...(stylesForIndex[i] || {}),
          ...annotationStyles,
        }
      }
    })
  })

  let currentText = text[0] || ''
  let currentStyles = stylesForIndex[0]

  for (let i = 1; i < text.length; i++) {
    if (areStylesEqual(stylesForIndex[i], currentStyles, allStyleKeys)) {
      currentText += text[i]
    } else {
      inlines.push({
        text: currentText,
        type: 'text',
        styles: currentStyles || {},
      })

      currentText = text[i]
      currentStyles = stylesForIndex[i]
    }
  }

  if (currentText.length) {
    inlines.push({
      text: currentText,
      type: 'text',
      styles: currentStyles || {},
    })
  }

  return inlines
}
