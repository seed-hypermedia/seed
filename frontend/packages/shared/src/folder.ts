import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {createDefaultFolderQueryBlock} from './models/document-machine'

/** Builds the metadata and initial self-query block for a folder draft. */
export function buildFolderDraftSeed(blockId: string): {metadata: HMMetadata; content: EditorBlock[]} {
  return {
    metadata: {},
    content: [createDefaultFolderQueryBlock(blockId)],
  }
}
