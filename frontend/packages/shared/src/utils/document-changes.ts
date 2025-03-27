import {Empty} from '@bufbuild/protobuf'
import {DocumentChange, DocumentChange_SetAttribute} from '../client'
import {HMBlock, HMBlockNode, HMMetadata} from '../hm-types'

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

export function extractMetaEntries(jsonObject: {}): [
  string[],
  PrimitiveValue,
][] {
  return Object.entries(jsonObject).flatMap(
    ([key, value]: [string, unknown]) => {
      if (typeof value === 'object' && value !== null) {
        return extractMetaEntries(value).map(([k, v]) => [key + '.' + k, v])
      }
      return [[[key], value]]
    },
  )
}

function docAttributeChangeNull(key: string[]) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'nullValue',
          value: new Empty(),
        },
      }),
    },
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
function docAttributeChangeInt(key: string[], value: number) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value: {
          case: 'intValue',
          value: BigInt(value),
        },
      }),
    },
  })
}
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
