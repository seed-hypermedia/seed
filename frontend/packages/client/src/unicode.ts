import type {HMAnnotations} from './hm-types'

/**
 * Mutable annotation shape used during construction.
 * Structurally compatible with HMAnnotation but uses plain objects
 * instead of protobuf classes.
 */
export interface MutableAnnotation {
  type: string
  link?: string
  attributes?: Record<string, unknown>
  starts: number[]
  ends: number[]
}

/** Minimal annotation shape required by span-position helpers. */
export interface SpanAnnotation {
  starts: number[]
  ends: number[]
}

export class AnnotationSet {
  annotations: Map<string, MutableAnnotation>

  constructor() {
    this.annotations = new Map()
  }

  addSpan(type: string, attributes: {[key: string]: string} | null, start: number, end: number) {
    const id = this._annotationId(type, attributes)

    let annotation = this.annotations.get(id)
    if (!annotation) {
      // Build a plain annotation object (no protobuf class needed).
      const annAttrs: Record<string, unknown> = attributes ? {...attributes} : {}

      let link: string | undefined
      if (type == 'Link' || type == 'Embed') {
        link = (attributes as any)?.link
        delete annAttrs.link
      }

      annotation = {
        type,
        attributes: annAttrs,
        link: link || '',
        starts: [],
        ends: [],
      }

      this.annotations.set(id, annotation)
    }

    addSpanToAnnotation(annotation, start, end)
  }

  _annotationId(type: string, attributes: {[key: string]: string} | null) {
    if (attributes) {
      if (attributes.link) {
        return `${type}-${attributes.link}`
      }

      if (attributes.href) {
        return `${type}-${attributes.href}`
      }

      // add more attributes: color, embed, ...
    }

    return type
  }

  list(): HMAnnotations {
    // We sort annotations by their "identity" key.
    const keys = Array.from(this.annotations.keys()).sort()
    // Then we create an output array of the same size as the number of annotations.
    let out: MutableAnnotation[] = new Array(keys.length)
    // Then we add annotations in the proper order.
    for (let i in keys) {
      // @ts-ignore
      const annotation = this.annotations.get(keys[i])
      if (annotation) out[i] = annotation
    }

    out = out.sort((a, b) => {
      let startA = a.starts[0]
      let startB = b.starts[0]

      return (startA || 0) - (startB || 0)
    })

    return out as HMAnnotations
  }
}

/** Append a span to an annotation, merging with the previous span if adjacent. */
export function addSpanToAnnotation(annotation: SpanAnnotation, start: number, end: number) {
  // We don't need to use any fancy range set data structure here, because we know specifics of our environment,
  // i.e. we know that we'll only ever iterate over the Slate leaves in order, only going forward and never backwards.
  // So, all the possible derived spans will always be sorted.
  // Therefore, to detect adjacent spans, we only need to check the last one and the incoming one.

  if (!annotation.starts) {
    annotation.starts = []
  }

  if (!annotation.ends) {
    annotation.ends = []
  }

  if (annotation.starts.length == 0) {
    pushSpanToAnnotation(annotation, start, end)
    return
  }

  const lastIdx = annotation.starts.length - 1

  // If the incoming span continues the one we already have
  // we just extend the old end until the incoming end,
  // i.e. we merge two spans together.
  if (annotation.ends[lastIdx] == start) {
    annotation.ends[lastIdx] = end
    return
  }

  // Otherwise we just append the span.
  pushSpanToAnnotation(annotation, start, end)
}

/** Push a span to an annotation without checking adjacency. */
export function pushSpanToAnnotation(annotation: SpanAnnotation, start: number, end: number) {
  annotation.starts.push(start)
  annotation.ends.push(end)
}

/** @deprecated Import from `@seed-hypermedia/client/hm-types` instead. */
export {codePointLength, isSurrogate} from './hm-types'
