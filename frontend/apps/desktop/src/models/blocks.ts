import {HMBlock, HMQuery} from '@shm/shared'
import _ from 'lodash'

// Type for comparing blocks that may have different properties based on their type
type GenericBlockFields = {
  id: string
  type: string
  text?: string
  link?: string
  annotations?: unknown[]
  attributes?: Record<string, unknown>
}

export function isBlocksEqual(b1: HMBlock, b2: HMBlock): boolean {
  if (!b1 || !b2) {
    console.log('Blocks not equal: One or both blocks are null/undefined', {
      b1,
      b2,
    })
    return false
  }
  if (b1 === b2) return true

  // Cast to generic type for property access
  const block1 = b1 as GenericBlockFields
  const block2 = b2 as GenericBlockFields

  // Helper function to compare annotations, treating undefined and empty arrays as equal
  const areAnnotationsEqual = (a1?: unknown[], a2?: unknown[]) => {
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
    id: block1.id === block2.id,
    text: isTextEqual(block1.text, block2.text),
    link: block1.link === block2.link,
    type: block1.type === block2.type,
    annotations: areAnnotationsEqual(block1.annotations, block2.annotations),
    attributes: isBlockAttributesEqual(b1, b2),
  }

  const result = Object.values(checks).every(Boolean)

  if (!result) {
    console.log('Blocks not equal. Differences found:', {
      blockId: block1.id,
      differences: Object.entries(checks)
        .filter(([_, isEqual]) => !isEqual)
        .map(([prop]) => ({
          property: prop,
          b1Value:
            prop === 'annotations'
              ? block1.annotations
              : prop === 'attributes'
              ? block1.attributes
              : block1[prop as keyof GenericBlockFields],
          b2Value:
            prop === 'annotations'
              ? block2.annotations
              : prop === 'attributes'
              ? block2.attributes
              : block2[prop as keyof GenericBlockFields],
        })),
    })
  }

  return result
}

function isBlockAttributesEqual(b1: HMBlock, b2: HMBlock): boolean {
  const a1 = (b1 as GenericBlockFields).attributes as
    | Record<string, unknown>
    | undefined
  const a2 = (b2 as GenericBlockFields).attributes as
    | Record<string, unknown>
    | undefined

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
      return isQueryEqual(
        a1.query as HMQuery | undefined,
        a2.query as HMQuery | undefined,
      )
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

    if (!include1 || !include2) return false
    if (include1.mode !== include2.mode) return false
    if (include1.path !== include2.path) return false
    if (include1.space !== include2.space) return false
  }

  const sort1Arr = q1.sort || []
  const sort2Arr = q2.sort || []
  if (sort1Arr.length !== sort2Arr.length) return false

  for (let i = 0; i < sort1Arr.length; i++) {
    const sort1 = sort1Arr[i]
    const sort2 = sort2Arr[i]

    if (!sort1 || !sort2) return false
    if (sort1.reverse !== sort2.reverse) return false
    if (sort1.term !== sort2.term) return false
  }
  return true
}
