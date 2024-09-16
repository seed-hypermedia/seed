import {HMAnnotations} from '..'
import {Annotation} from './.generated/documents/v3alpha/documents_pb'

export class AnnotationSet {
  annotations: Map<string, Annotation>

  constructor() {
    this.annotations = new Map()
  }

  addSpan(
    type: string,
    attributes: {[key: string]: string} | null,
    start: number,
    end: number,
  ) {
    const id = this._annotationId(type, attributes)

    let annotation = this.annotations.get(id)
    if (!annotation) {
      annotation = new Annotation({
        type,
        attributes: attributes ?? {},
        starts: [],
        ends: [],
      })

      if (type == 'link' || type == 'inline-embed') {
        annotation.ref = attributes!.ref
        // @ts-expect-error
        delete annotation.attributes
      }

      if (typeof annotation.ref == 'string' && annotation.ref.length == 0) {
        // @ts-expect-error
        delete annotation.ref
      }

      if (
        'attributes' in annotation &&
        Object.keys(annotation.attributes).length == 0
      ) {
        // @ts-expect-error
        delete annotation.attributes
      }

      this.annotations.set(id, annotation)
    }

    addSpanToAnnotation(annotation, start, end)
  }

  _annotationId(type: string, attributes: {[key: string]: string} | null) {
    if (attributes) {
      if (attributes.ref) {
        return `${type}-${attributes.ref}`
      }

      // add more attributes: color, embed, ...
    }

    return type
  }

  list(): HMAnnotations {
    // We sort annotations by their "identity" key.
    const keys = Array.from(this.annotations.keys()).sort()
    // Then we create an output array of the same size as the number of annotations.
    let out: Annotation[] = new Array(keys.length)
    // Then we add annotations in the proper order.
    for (let i in keys) {
      const annotation = this.annotations.get(keys[i])
      if (annotation) out[i] = annotation
    }

    out = out.sort((a, b) => {
      let startA = a.starts[0]
      let startB = b.starts[0]

      return startA - startB
    })

    return out as HMAnnotations
  }
}

export function addSpanToAnnotation(
  annotation: Annotation,
  start: number,
  end: number,
) {
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

export function pushSpanToAnnotation(
  annotation: Annotation,
  start: number,
  end: number,
) {
  console.log('annotationsss', annotation)
  annotation.starts.push(start)
  annotation.ends.push(end)
}

export function codePointLength(entry: string) {
  let count = 0
  if (!entry) return 0
  for (let i = 0; i < entry.length; i++) {
    count++

    if (isSurrogate(entry, i)) {
      i++
    }
  }
  return count
}

// Checks if a UTF-16 code unit i in string s is start of a surrogate pair.
export function isSurrogate(s: string, i: number) {
  const code = s.charCodeAt(i)
  return 0xd800 <= code && code <= 0xdbff
}
