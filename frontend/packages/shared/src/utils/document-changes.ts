import _ from 'lodash'
import {DocumentChange_SetAttribute} from '../client'
import {
  Block,
  DocumentChange,
} from '../client/.generated/documents/v3alpha/documents_pb'
import {editorBlockToHMBlock} from '../client/editorblock-to-hmblock'
import {EditorBlock} from '../editor-types'
import {HMBlock, HMBlockNode, HMMetadata, HMQuery} from '../hm-types'

export type AttributeValueType =
  | 'boolValue'
  | 'nullValue'
  | 'intValue'
  | 'stringValue'

export type BlocksMap = Record<string, BlocksMapItem>

export type BlocksMapItem = {
  parent: string
  left: string
  block: HMBlock
}

export function getDocAttributeChanges(metadata: HMMetadata) {
  const changes = []
  if (metadata.name !== undefined)
    changes.push(docAttributeChangeString(['name'], metadata.name))
  if (metadata.summary !== undefined)
    changes.push(docAttributeChangeString(['summary'], metadata.summary))
  if (metadata.icon !== undefined)
    changes.push(docAttributeChangeString(['icon'], metadata.icon))
  if (metadata.thumbnail !== undefined)
    changes.push(docAttributeChangeString(['thumbnail'], metadata.thumbnail))
  if (metadata.cover !== undefined)
    changes.push(docAttributeChangeString(['cover'], metadata.cover))
  if (metadata.siteUrl !== undefined)
    changes.push(docAttributeChangeString(['siteUrl'], metadata.siteUrl))
  if (metadata.layout !== undefined)
    changes.push(docAttributeChangeString(['layout'], metadata.layout))
  if (metadata.displayPublishTime !== undefined)
    changes.push(
      docAttributeChangeString(
        ['displayPublishTime'],
        metadata.displayPublishTime,
      ),
    )
  if (metadata.seedExperimentalLogo !== undefined)
    changes.push(
      docAttributeChangeString(
        ['seedExperimentalLogo'],
        metadata.seedExperimentalLogo,
      ),
    )
  if (metadata.seedExperimentalHomeOrder !== undefined)
    changes.push(
      docAttributeChangeString(
        ['seedExperimentalHomeOrder'],
        metadata.seedExperimentalHomeOrder,
      ),
    )
  if (metadata.showOutline !== undefined)
    changes.push(docAttributeChangeBool(['showOutline'], metadata.showOutline))
  if (metadata.theme !== undefined) {
    if (metadata.theme.headerLayout !== undefined)
      changes.push(
        docAttributeChangeString(
          ['theme', 'headerLayout'],
          metadata.theme.headerLayout,
        ),
      )
  }
  if (metadata.contentWidth !== undefined) {
    changes.push(
      docAttributeChangeString(['contentWidth'], metadata.contentWidth),
    )
  }
  if (metadata.showActivity !== undefined) {
    changes.push(
      docAttributeChangeBool(['showActivity'], metadata.showActivity),
    )
  }
  return changes
}

type PrimitiveValue = string | number | boolean | null | undefined

export function extractMetaEntries(
  jsonObject: Record<string, unknown>,
): [string[], PrimitiveValue][] {
  return Object.entries(jsonObject).flatMap(([key, value]) => {
    if (typeof value === 'object' && value !== null) {
      return extractMetaEntries(value as Record<string, unknown>).map(
        ([k, v]) => [[key, ...k], v] as [string[], PrimitiveValue],
      )
    }
    return [[[key], value as PrimitiveValue]] as [string[], PrimitiveValue][]
  })
}

function docAttributeChangeString(key: string[], value: string) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'stringValue',
          value,
        },
      }),
    },
  })
}
// function docAttributeChangeInt(key: string[], value: number) {
//   return new DocumentChange({
//     op: {
//       case: 'setAttribute',
//       value: new DocumentChange_SetAttribute({
//         blockId: '',
//         key,
//         value: {
//           case: 'intValue',
//           value: BigInt(value),
//         },
//       }),
//     },
//   })
// }
function docAttributeChangeBool(key: string[], value: boolean) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'boolValue',
          value,
        },
      }),
    },
  })
}

export function createBlocksMap(
  blockNodes: Array<HMBlockNode> = [],
  parentId: string,
) {
  let result: BlocksMap = {}
  blockNodes.forEach((bn, idx) => {
    if (bn.block?.id) {
      let prevBlockNode = idx > 0 ? blockNodes[idx - 1] : undefined

      if (bn.block) {
        result[bn.block.id] = {
          parent: parentId,
          left:
            prevBlockNode && prevBlockNode.block ? prevBlockNode.block.id : '',
          block: bn.block,
        }
      }

      if (bn.children?.length) {
        // recursively call the block children and append to the result
        result = {...result, ...createBlocksMap(bn.children, bn.block.id)}
      }
    }
  })

  return result
}

export function compareBlocksWithMap(
  blocksMap: BlocksMap,
  blocks: Array<EditorBlock>,
  parentId: string,
) {
  let changes: Array<DocumentChange> = []
  let touchedBlocks: Array<string> = []

  // iterate over editor blocks
  blocks?.forEach((block, idx) => {
    // add blockid to the touchedBlocks list to capture deletes later
    touchedBlocks.push(block.id)

    // compare replace
    let prevBlockState = blocksMap[block.id]

    // const childGroup = getBlockGroup(editor, block.id) // TODO: do this with no editor
    let currentBlockState = editorBlockToHMBlock(block)

    type BlockWithAttributes = {attributes?: {listLevel?: unknown}}
    const prevAttrs = prevBlockState?.block as BlockWithAttributes | undefined
    const currAttrs = currentBlockState as BlockWithAttributes

    if (
      !prevBlockState ||
      prevAttrs?.attributes?.listLevel !== currAttrs.attributes?.listLevel
    ) {
      const serverBlock = editorBlockToHMBlock(block)

      // add moveBlock change by default to all blocks
      changes.push(
        new DocumentChange({
          op: {
            case: 'moveBlock',
            value: {
              blockId: block.id,
              leftSibling: idx > 0 ? blocks[idx - 1]!.id : '',
              parent: parentId,
            },
          },
        }),
        new DocumentChange({
          op: {
            case: 'replaceBlock',
            value: Block.fromJson(serverBlock),
          },
        }),
      )
    } else {
      let left = idx > 0 ? blocks[idx - 1]!.id : ''
      if (prevBlockState.left !== left || prevBlockState.parent !== parentId) {
        changes.push(
          new DocumentChange({
            op: {
              case: 'moveBlock',
              value: {
                blockId: block.id,
                leftSibling: left,
                parent: parentId,
              },
            },
          }),
        )
      }

      if (!isBlocksEqual(prevBlockState.block, currentBlockState)) {
        // this means is a new block and we need to also add a replaceBlock change
        changes.push(
          new DocumentChange({
            op: {
              case: 'replaceBlock',
              value: Block.fromJson(currentBlockState),
            },
          }),
        )
      }
    }

    if (block.children.length) {
      let nestedResults = compareBlocksWithMap(
        blocksMap,
        block.children,
        block.id,
      )
      changes = [...changes, ...nestedResults.changes]
      touchedBlocks = [...touchedBlocks, ...nestedResults.touchedBlocks]
    }
  })

  return {
    changes,
    touchedBlocks,
  }
}

export function extractDeletes(
  blocksMap: BlocksMap,
  touchedBlocks: Array<string>,
) {
  let deletedIds = Object.keys(blocksMap).filter(
    (id) => !touchedBlocks.includes(id),
  )

  return deletedIds.map(
    (dId) =>
      new DocumentChange({
        op: {
          case: 'deleteBlock',
          value: dId,
        },
      }),
  )
}

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
    'style', // Query block style attribute
  ]

  // Helper function to check if a single attribute is equal
  const isAttributeEqual = (attr: string) => {
    if (attr === 'query') {
      return isQueryEqual(a1.query, a2.query)
    }
    return (
      (a1[attr] === undefined && a2[attr] === undefined) ||
      a1[attr] === a2[attr]
    )
  }

  const result = attributesToCompare.every(isAttributeEqual)

  if (!result) {
    console.log('Block attributes not equal. Differences found:', {
      blockId: b1.id,
      differences: attributesToCompare
        .filter((attr) => !isAttributeEqual(attr))
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

  // Compare includes arrays - handle undefined/null cases
  const includes1 = q1.includes || []
  const includes2 = q2.includes || []

  if (includes1.length !== includes2.length) return false

  // Deep compare each include item
  for (let i = 0; i < includes1.length; i++) {
    const include1 = includes1[i]!
    const include2 = includes2[i]!

    if (include1.mode !== include2.mode) return false
    if (include1.path !== include2.path) return false
    if (include1.space !== include2.space) return false
  }

  // Note: The sort comparison above with _.isEqual should already handle this,
  // but keeping the explicit loop for consistency
  if ((q1.sort?.length || 0) !== (q2.sort?.length || 0)) return false

  for (let i = 0; i < (q1.sort?.length || 0); i++) {
    const sort1 = q1.sort![i]!
    const sort2 = q2.sort![i]!

    if (sort1.reverse !== sort2.reverse) return false

    if (sort1.term !== sort2.term) return false
  }
  return true
}
