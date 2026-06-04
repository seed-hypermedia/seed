import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {editorBlockToHMBlock} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {HMBlock, HMBlockNode, HMMetadata, HMQuery} from '@seed-hypermedia/client/hm-types'
import isEqual from 'lodash/isEqual'
import {nanoid} from 'nanoid'
import {DocumentChange_SetAttribute} from '../client'
import {Block, DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'

export type AttributeValueType = 'boolValue' | 'nullValue' | 'intValue' | 'stringValue'

export type BlocksMap = Record<string, BlocksMapItem>

export type BlocksMapItem = {
  parent: string
  left: string
  block: HMBlock
}

export function getDocAttributeChanges(metadata: HMMetadata) {
  const changes = []
  if (metadata.name !== undefined) changes.push(docAttributeChangeString(['name'], metadata.name))
  if (metadata.summary !== undefined) changes.push(docAttributeChangeString(['summary'], metadata.summary))
  if (metadata.icon !== undefined) changes.push(docAttributeChangeString(['icon'], metadata.icon))
  if (metadata.thumbnail !== undefined) changes.push(docAttributeChangeString(['thumbnail'], metadata.thumbnail))
  if (metadata.cover !== undefined) changes.push(docAttributeChangeString(['cover'], metadata.cover))
  if (metadata.siteUrl !== undefined) changes.push(docAttributeChangeString(['siteUrl'], metadata.siteUrl))
  if (metadata.layout !== undefined) changes.push(docAttributeChangeString(['layout'], metadata.layout))
  if (metadata.displayAuthor !== undefined)
    changes.push(docAttributeChangeString(['displayAuthor'], metadata.displayAuthor))
  if (metadata.displayPublishTime !== undefined)
    changes.push(docAttributeChangeString(['displayPublishTime'], metadata.displayPublishTime))
  if (metadata.seedExperimentalLogo !== undefined)
    changes.push(docAttributeChangeString(['seedExperimentalLogo'], metadata.seedExperimentalLogo))
  if (metadata.seedExperimentalHomeOrder !== undefined)
    changes.push(docAttributeChangeString(['seedExperimentalHomeOrder'], metadata.seedExperimentalHomeOrder))
  if (metadata.showOutline !== undefined) changes.push(docAttributeChangeBool(['showOutline'], metadata.showOutline))
  if (metadata.theme !== undefined) {
    if (metadata.theme.headerLayout !== undefined)
      changes.push(docAttributeChangeString(['theme', 'headerLayout'], metadata.theme.headerLayout))
  }
  if (metadata.contentWidth !== undefined) {
    changes.push(docAttributeChangeString(['contentWidth'], metadata.contentWidth))
  }
  if (metadata.childrenType !== undefined) {
    changes.push(docAttributeChangeString(['childrenType'], metadata.childrenType || ''))
  }
  if (metadata.showActivity !== undefined) {
    changes.push(docAttributeChangeBool(['showActivity'], metadata.showActivity))
  }
  return changes
}

type PrimitiveValue = string | number | boolean | null | undefined

export function extractMetaEntries(jsonObject: Record<string, unknown>): [string[], PrimitiveValue][] {
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

export function createBlocksMap(blockNodes: Array<HMBlockNode> = [], parentId: string) {
  let result: BlocksMap = {}
  blockNodes.forEach((bn, idx) => {
    if (bn.block?.id) {
      let prevBlockNode = idx > 0 ? blockNodes[idx - 1] : undefined

      if (bn.block) {
        result[bn.block.id] = {
          parent: parentId,
          left: prevBlockNode && prevBlockNode.block ? prevBlockNode.block.id : '',
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

export function compareBlocksWithMap(blocksMap: BlocksMap, blocks: Array<EditorBlock>, parentId: string) {
  const repaired = deduplicateBlockIds(blocks, new Set(Object.keys(blocksMap)))
  return compareUniqueBlocksWithMap(blocksMap, repaired, parentId)
}

function compareUniqueBlocksWithMap(blocksMap: BlocksMap, blocks: Array<EditorBlock>, parentId: string) {
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

    if (!prevBlockState || prevAttrs?.attributes?.listLevel !== currAttrs.attributes?.listLevel) {
      const serverBlock = editorBlockToHMBlock(block)

      // add moveBlock change by default to all blocks
      changes.push(
        new DocumentChange({
          op: {
            case: 'moveBlock',
            value: {
              blockId: block.id,
              leftSibling: idx > 0 ? blocks[idx - 1]?.id ?? '' : '',
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
      let left = idx > 0 ? blocks[idx - 1]?.id ?? '' : ''
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
      let nestedResults = compareUniqueBlocksWithMap(blocksMap, block.children, block.id)
      changes = [...changes, ...nestedResults.changes]
      touchedBlocks = [...touchedBlocks, ...nestedResults.touchedBlocks]
    }
  })

  return {
    changes,
    touchedBlocks,
  }
}

export function extractDeletes(blocksMap: BlocksMap, touchedBlocks: Array<string>) {
  let deletedIds = Object.keys(blocksMap).filter((id) => !touchedBlocks.includes(id))

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
    // console.log('Blocks not equal: One or both blocks are null/undefined', {
    //   b1,
    //   b2,
    // })
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
    return isEqual(a1, a2)
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

  // if (!result) {
  //   console.log('Blocks not equal. Differences found:', {
  //     blockId: block1.id,
  //     differences: Object.entries(checks)
  //       .filter(([_, isEqual]) => !isEqual)
  //       .map(([prop]) => ({
  //         property: prop,
  //         b1Value:
  //           prop === 'annotations'
  //             ? block1.annotations
  //             : prop === 'attributes'
  //             ? block1.attributes
  //             : block1[prop as keyof GenericBlockFields],
  //         b2Value:
  //           prop === 'annotations'
  //             ? block2.annotations
  //             : prop === 'attributes'
  //             ? block2.attributes
  //             : block2[prop as keyof GenericBlockFields],
  //       })),
  //   })
  // }

  return result
}

function isBlockAttributesEqual(b1: HMBlock, b2: HMBlock): boolean {
  const a1 = (b1 as GenericBlockFields).attributes as Record<string, unknown> | undefined
  const a2 = (b2 as GenericBlockFields).attributes as Record<string, unknown> | undefined

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
    'autoplay',
    'loop',
    'muted',
  ]

  // Helper function to check if a single attribute is equal
  const isAttributeEqual = (attr: string) => {
    if (attr === 'query') {
      return isQueryEqual(a1.query as HMQuery | undefined, a2.query as HMQuery | undefined)
    }
    return (a1[attr] === undefined && a2[attr] === undefined) || a1[attr] === a2[attr]
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

// -- Rebase helpers --

/**
 * Flatten HMBlockNode tree into {id -> block}, preserving recursion into children.
 * Used by the rebase classifier to compare blocks across base / mine / theirs.
 */
function flattenBlocks(nodes: HMBlockNode[]): Map<string, HMBlock> {
  const out = new Map<string, HMBlock>()
  const walk = (ns: HMBlockNode[]) => {
    for (const n of ns) {
      if (n.block?.id) out.set(n.block.id, n.block)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Collect all block IDs present in an HMBlockNode tree. */
function collectBlockIds(nodes: HMBlockNode[]): Set<string> {
  const out = new Set<string>()
  const walk = (ns: HMBlockNode[]) => {
    for (const n of ns) {
      if (n.block?.id) out.add(n.block.id)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Classify which block IDs were touched by the remote side (theirs).
 *
 * A block is considered "touched by theirs" when:
 *  - its `revision` (CID of the last change that modified it) is present in
 *    `newChangeCids` — the set of CIDs introduced since our base, OR
 *  - the block exists in base but is missing in theirs (structural delete), OR
 *  - the block is new in theirs but absent from base (structural add).
 *
 * If `revision` is missing (legacy blocks), falls back to a deep-equals check
 * against base.
 */
export function computeTheirsTouches(
  base: HMBlockNode[],
  theirs: HMBlockNode[],
  newChangeCids: Set<string>,
): Set<string> {
  const baseMap = flattenBlocks(base)
  const theirsMap = flattenBlocks(theirs)
  const touched = new Set<string>()

  theirsMap.forEach((block, id) => {
    const baseBlock = baseMap.get(id)
    if (!baseBlock) {
      touched.add(id) // structural add
      return
    }
    const rev = (block as {revision?: string}).revision
    if (rev && newChangeCids.has(rev)) {
      touched.add(id)
      return
    }
    if (!rev && !isBlocksEqual(baseBlock, block)) {
      touched.add(id)
    }
  })

  baseMap.forEach((_, id) => {
    if (!theirsMap.has(id)) touched.add(id) // structural delete
  })

  return touched
}

/**
 * A rebase plan describes, per-block, where the final merged tree should source
 * content from for each block id. This is the minimal shape consumed by
 * `applyRebasePlan` and extensible for Phase B per-block user picks.
 */
export type RebasePlan = {
  /** Final merged tree uses theirs as the scaffold (ordering, structure). */
  scaffold: 'theirs'
  /** Block IDs that should keep Mine's content, overriding theirs. */
  mineBlocks: Set<string>
  /** Block IDs that should use theirs. All other blocks also use theirs. */
  theirsBlocks: Set<string>
  /** Block IDs that need conflict resolution (in Phase B). */
  conflictedBlockIds: string[]
}

export type RebaseClassification = {
  /** True when there are no conflicts and the plan can be applied silently. */
  autoMergeable: boolean
  conflictedBlockIds: string[]
  plan: RebasePlan
}

/**
 * Classify a rebase given three-way knowledge.
 *
 * - `base`: published blocks at edit-start time.
 * - `mine`: current editor blocks (the user's in-progress draft).
 * - `theirs`: blocks of the incoming remote document.
 * - `mineTouchedIds`: IDs the user edited locally, tracked by ProseMirror listener.
 * - `newChangeCids`: CIDs introduced between base and theirs' version.
 *
 * Conflicts = blocks touched on both sides. Includes edit-vs-edit, edit-vs-delete,
 * and delete-vs-edit via structural intersection logic.
 */
export function classifyRebase(
  base: HMBlockNode[],
  mine: HMBlockNode[],
  theirs: HMBlockNode[],
  mineTouchedIds: Iterable<string>,
  newChangeCids: Set<string>,
): RebaseClassification {
  const theirsTouched = computeTheirsTouches(base, theirs, newChangeCids)

  const baseIds = collectBlockIds(base)
  const mineIds = collectBlockIds(mine)

  // Extend mineTouched with structural deletes (in base, not in mine) so
  // "user deleted a block" participates in conflict detection.
  const mineTouched = new Set<string>(mineTouchedIds)
  baseIds.forEach((id) => {
    if (!mineIds.has(id)) mineTouched.add(id)
  })
  // And structural adds (in mine, not in base).
  mineIds.forEach((id) => {
    if (!baseIds.has(id)) mineTouched.add(id)
  })

  const conflicted: string[] = []
  mineTouched.forEach((id) => {
    if (theirsTouched.has(id)) conflicted.push(id)
  })

  // Blocks we take from mine: any block mine touched that theirs did NOT touch.
  const mineBlocks = new Set<string>()
  mineTouched.forEach((id) => {
    if (!theirsTouched.has(id)) mineBlocks.add(id)
  })

  const theirsBlocks = new Set<string>(theirsTouched)

  return {
    autoMergeable: conflicted.length === 0,
    conflictedBlockIds: conflicted,
    plan: {
      scaffold: 'theirs',
      mineBlocks,
      theirsBlocks,
      conflictedBlockIds: conflicted,
    },
  }
}

/**
 * Apply a rebase plan to produce the final merged HMBlockNode[] tree.
 *
 * Strategy: walk theirs' structure (ordering, nesting). For each block id:
 *   - If picked as "mine" (either by the plan or user pick in Phase B),
 *     take the block payload from `mine`.
 *   - Otherwise keep theirs.
 *
 * Then re-attach any mine-exclusive blocks (present in mine, absent from theirs
 * and not deleted by theirs) at their original mine-relative positions under
 * their original parent when the parent still exists. If the parent was
 * removed by theirs, they are appended at the end of the root list.
 *
 * `picks` is an optional per-block override (used by Phase B conflict modal).
 * Default: conflicted blocks take theirs (Phase A never produces this path
 * because auto-merge gates on no conflicts; Phase B supplies picks).
 */
export function applyRebasePlan(
  mine: HMBlockNode[],
  theirs: HMBlockNode[],
  plan: RebasePlan,
  picks: Record<string, 'mine' | 'theirs'> = {},
): HMBlockNode[] {
  const mineFlat = flattenBlocks(mine)
  const mineChildrenOf = buildChildrenMap(mine)
  const theirsIds = collectBlockIds(theirs)

  const chooseMine = (id: string): boolean => {
    const pick = picks[id]
    if (pick === 'mine') return true
    if (pick === 'theirs') return false
    return plan.mineBlocks.has(id)
  }

  const rebuild = (nodes: HMBlockNode[]): HMBlockNode[] =>
    nodes.map((n) => {
      const id = n.block?.id
      const block = id && chooseMine(id) ? mineFlat.get(id) ?? n.block : n.block
      return {
        block,
        children: n.children?.length ? rebuild(n.children) : n.children,
      } as HMBlockNode
    })

  const rebuilt = rebuild(theirs)

  // Re-attach mine-only blocks (adds) that theirs didn't include and weren't deleted by theirs.
  const appended: HMBlockNode[] = []
  const mineOnlyIds: string[] = []
  mineFlat.forEach((_, id) => {
    if (!theirsIds.has(id)) mineOnlyIds.push(id)
  })

  for (const id of mineOnlyIds) {
    const block = mineFlat.get(id)
    if (!block) continue
    const children = mineChildrenOf.get(id) ?? []
    appended.push({block, children} as HMBlockNode)
  }

  return appended.length ? [...rebuilt, ...appended] : rebuilt
}

/** Build {parentId -> children HMBlockNode[]} for a tree. Root uses key ''. */
function buildChildrenMap(nodes: HMBlockNode[]): Map<string, HMBlockNode[]> {
  const map = new Map<string, HMBlockNode[]>()
  const walk = (ns: HMBlockNode[], parent: string) => {
    const bucket = map.get(parent) ?? []
    for (const n of ns) {
      bucket.push(n)
      if (n.block?.id && n.children?.length) walk(n.children, n.block.id)
    }
    map.set(parent, bucket)
  }
  walk(nodes, '')
  return map
}

/**
 * Walk editor blocks and assign fresh IDs to duplicates so the CRDT
 * move-block operations never send block==left to the backend.
 *
 * Published IDs (from blocksMap) are "reserved": the first encounter
 * of a published ID always keeps it; only subsequent occurrences are
 * renamed. Non-published duplicate IDs follow the same first-wins rule.
 * Empty / falsy IDs are always replaced. The `generate` factory is
 * called in a loop until it produces an ID not already in use.
 */
export function deduplicateBlockIds(
  blocks: EditorBlock[],
  publishedIds = new Set<string>(),
  generate: () => string = () => nanoid(8),
): EditorBlock[] {
  const usedIds = new Set<string>(publishedIds)
  const claimedPublished = new Set<string>()

  function freshId(): string {
    let id = generate()
    while (!id || usedIds.has(id)) id = generate()
    return id
  }

  function walk(block: EditorBlock): EditorBlock {
    let id = block.id
    const isFirstPublishedEncounter = !!id && publishedIds.has(id) && !claimedPublished.has(id)

    if (!id || (usedIds.has(id) && !isFirstPublishedEncounter)) {
      id = freshId()
    }

    if (block.id && publishedIds.has(block.id)) claimedPublished.add(block.id)
    usedIds.add(id)

    const children = block.children.map(walk)
    if (id !== block.id || children !== block.children) {
      return {...block, id, children}
    }
    return block
  }

  return blocks.map(walk)
}

function isQueryEqual(q1?: HMQuery, q2?: HMQuery): boolean {
  if (!q1 && !q2) return true
  if (!q1 || !q2) return false

  // Compare limit
  if (q1.limit !== q2.limit) return false

  // Compare sorting arrays
  if (!isEqual(q1.sort || [], q2.sort || [])) return false

  // Compare includes arrays - handle undefined/null cases
  const includes1 = q1.includes || []
  const includes2 = q2.includes || []

  if (includes1.length !== includes2.length) return false

  // Deep compare each include item
  for (let i = 0; i < includes1.length; i++) {
    const include1 = includes1[i]
    const include2 = includes2[i]

    if (!include1 || !include2) return false
    if (include1.mode !== include2.mode) return false
    if (include1.path !== include2.path) return false
    if (include1.space !== include2.space) return false
  }

  // Note: The sort comparison above with _.isEqual should already handle this,
  // but keeping the explicit loop for consistency
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
