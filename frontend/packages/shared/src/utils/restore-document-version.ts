import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'
import {compareBlocksWithMap, createBlocksMap, extractDeletes, getDocAttributeChanges} from './document-changes'

/** Build document changes that restore selected version content and metadata on top of the latest document. */
export function buildRestoreVersionChanges(latestDocument: HMDocument, selectedVersion: HMDocument): DocumentChange[] {
  const latestBlocksMap = createBlocksMap(latestDocument.content ?? [], '')
  const selectedEditorBlocks = hmBlocksToEditorContent(selectedVersion.content ?? [], {childrenType: 'Group'})
  const blockDiff = compareBlocksWithMap(latestBlocksMap, selectedEditorBlocks, '')
  const deleteChanges = extractDeletes(latestBlocksMap, blockDiff.touchedBlocks)
  return [
    ...getDocAttributeChanges(selectedVersion.metadata ?? {}, latestDocument.metadata ?? {}),
    ...blockDiff.changes,
    ...deleteChanges,
  ]
}
