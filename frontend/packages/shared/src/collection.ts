import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {createDefaultCollectionQueryBlock} from './models/document-machine'

/** Builds the metadata and initial self-query block for a collection draft. */
export function buildCollectionDraftSeed(blockId: string): {metadata: HMMetadata; content: EditorBlock[]} {
  return {
    metadata: {},
    content: [createDefaultCollectionQueryBlock(blockId)],
  }
}
