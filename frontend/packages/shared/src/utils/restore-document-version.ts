import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {editorBlockToHMBlock} from '@seed-hypermedia/client/editorblock-to-hmblock'
import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {Block, DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'
import {createBlocksMap, extractDeletes, getDocAttributeChanges} from './document-changes'

/** Build document changes that restore selected version content and metadata on top of the latest document. */
export function buildRestoreVersionChanges(latestDocument: HMDocument, selectedVersion: HMDocument): DocumentChange[] {
  const latestBlocksMap = createBlocksMap(latestDocument.content ?? [], '')
  const selectedEditorBlocks = hmBlocksToEditorContent(selectedVersion.content ?? [], {childrenType: 'Group'})
  return [
    ...getDocAttributeChanges(selectedVersion.metadata ?? {}, latestDocument.metadata ?? {}),
    ...extractDeletes(latestBlocksMap, []),
    ...buildInsertBlockChanges(selectedEditorBlocks, ''),
  ]
}

/** Returns the existing generation that the restore publish must stay within. */
export function getRestoreVersionGeneration(latestDocument: HMDocument): number | bigint {
  const generation = latestDocument.generationInfo?.generation
  if (generation == null) throw new Error('Could not load the latest document generation')
  return generation
}

function buildInsertBlockChanges(blocks: EditorBlock[], parentId: string): DocumentChange[] {
  return blocks.flatMap((block, index) => [
    new DocumentChange({
      op: {
        case: 'moveBlock',
        value: {
          blockId: block.id,
          leftSibling: index > 0 ? blocks[index - 1]?.id ?? '' : '',
          parent: parentId,
        },
      },
    }),
    new DocumentChange({
      op: {
        case: 'replaceBlock',
        value: Block.fromJson(editorBlockToHMBlock(block)),
      },
    }),
    ...buildInsertBlockChanges(block.children, block.id),
  ])
}
