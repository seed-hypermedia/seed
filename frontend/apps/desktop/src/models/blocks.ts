import {HMBlock, HMQuery} from '@shm/shared'
import _ from 'lodash'

export function isBlocksEqual(b1: HMBlock, b2: HMBlock): boolean {
  if (!b1 || !b2) {
    console.log('Blocks not equal: One or both blocks are null/undefined', {
      b1,
      b2,
    })
    return false
  }
  if (b1 === b2) return true

  // Helper function to compare annotations, treating undefined and empty arrays as equal
  const areAnnotationsEqual = (a1?: any[], a2?: any[]) => {
    if (!a1 && !a2) return true
    if (!a1 && a2?.length === 0) return true
    if (!a2 && a1?.length === 0) return true
    return _.isEqual(a1, a2)
  }

  // Helper function to compare text, treating undefined and empty string as equal
  const isTextEqual = (t1?: string, t2?: string) => {
    if (!t1 && !t2) return true
    if (!t1 && t2 === '') return true
    if (!t2 && t1 === '') return true
    return t1 === t2
  }

  const checks = {
    id: b1.id === b2.id,
    // @ts-expect-error
    text: isTextEqual(b1.text, b2.text),
    // @ts-expect-error
    link: b1.link === b2.link,
    type: b1.type === b2.type,
    // @ts-expect-error
    annotations: areAnnotationsEqual(b1.annotations, b2.annotations),
    attributes: isBlockAttributesEqual(b1, b2),
  }

  const result = Object.values(checks).every(Boolean)

  if (!result) {
    console.log('Blocks not equal. Differences found:', {
      blockId: b1.id,
      differences: Object.entries(checks)
        .filter(([_, isEqual]) => !isEqual)
        .map(([prop]) => ({
          property: prop,
          b1Value:
            prop === 'annotations'
              ? // @ts-expect-error
                b1.annotations
              : prop === 'attributes'
              ? // @ts-expect-error
                b1.attributes
              : // @ts-expect-error
                b1[prop],
          b2Value:
            prop === 'annotations'
              ? // @ts-expect-error
                b2.annotations
              : prop === 'attributes'
              ? // @ts-expect-error
                b2.attributes
              : // @ts-expect-error
                b2[prop],
        })),
    })
  }

  return result
}

function isBlockAttributesEqual(b1: HMBlock, b2: HMBlock): boolean {
  // @ts-expect-error
  const a1 = b1.attributes
  // @ts-expect-error
  const a2 = b2.attributes

  if (!a1 && !a2) return true
  if (!a1 || !a2) {
    console.log('Block attributes not equal: One side is missing attributes', {
      blockId: b1.id,
      a1,
      a2,
    })
    return false
  }

  const attributesToCompare = [
    'childrenType',
    'start',
    'level',
    'url',
    'name',
    'alignment',
    'size',
    'href',
    'link',
    'language',
    'view',
    'width',
    'banner',
    'query',
    'columnCount',
  ]

  const result = attributesToCompare.every((attr) => {
    if (attr === 'query') {
      return isQueryEqual(a1.query, a2.query)
    }
    return (
      (a1[attr] === undefined && a2[attr] === undefined) ||
      a1[attr] === a2[attr]
    )
  })

  if (!result) {
    console.log('Block attributes not equal. Differences found:', {
      blockId: b1.id,
      differences: attributesToCompare
        .filter(
          (attr) =>
            !(
              (a1[attr] === undefined && a2[attr] === undefined) ||
              a1[attr] === a2[attr]
            ),
        )
        .map((attr) => ({
          attribute: attr,
          a1Value: a1[attr],
          a2Value: a2[attr],
        })),
    })
  }

  return result
}

function isQueryEqual(q1?: HMQuery, q2?: HMQuery): boolean {
  if (!q1 && !q2) return true
  if (!q1 || !q2) return false

  // Compare limit
  if (q1.limit !== q2.limit) return false

  // Compare sorting arrays
  if (!_.isEqual(q1.sort || [], q2.sort || [])) return false

  // Compare includes arrays
  if (q1.includes.length !== q2.includes.length) return false

  // Deep compare each include item
  for (let i = 0; i < q1.includes.length; i++) {
    const include1 = q1.includes[i]
    const include2 = q2.includes[i]

    // @ts-ignore
    if (include1.mode !== include2.mode) return false
    // @ts-ignore
    if (include1.path !== include2.path) return false
    // @ts-ignore
    if (include1.space !== include2.space) return false
  }

  if (q1.sort?.length !== q2.sort?.length) return false

  for (let i = 0; i < q1.sort!.length; i++) {
    const sort1 = q1.sort![i]
    const sort2 = q2.sort![i]

    // @ts-ignore
    if (sort1.reverse !== sort2.reverse) return false
    // @ts-ignore
    if (sort1.term !== sort2.term) return false
  }
  return true
}
