import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {Empty} from '@bufbuild/protobuf'
import {DocumentChange_SetAttribute} from '../client'
import {DocumentChange} from '../client/.generated/documents/v3alpha/documents_pb'
import {compareBlocksWithMap, createBlocksMap, extractDeletes} from './document-changes'

const metadataStringKeys = [
  'name',
  'summary',
  'icon',
  'thumbnail',
  'cover',
  'siteUrl',
  'layout',
  'displayAuthor',
  'displayPublishTime',
  'seedExperimentalLogo',
  'seedExperimentalHomeOrder',
  'contentWidth',
  'importCategories',
  'importTags',
] as const

const metadataBoolKeys = ['showOutline', 'showActivity'] as const

/** Build document changes that restore selected version content and metadata on top of the latest document. */
export function buildRestoreVersionChanges(latestDocument: HMDocument, selectedVersion: HMDocument): DocumentChange[] {
  const latestBlocksMap = createBlocksMap(latestDocument.content ?? [], '')
  const selectedEditorBlocks = hmBlocksToEditorContent(selectedVersion.content ?? [], {childrenType: 'Group'})
  const blockDiff = compareBlocksWithMap(latestBlocksMap, selectedEditorBlocks, '')
  const deleteChanges = extractDeletes(latestBlocksMap, blockDiff.touchedBlocks)
  return [
    ...buildRestoreMetadataChanges(latestDocument.metadata ?? {}, selectedVersion.metadata ?? {}),
    ...blockDiff.changes,
    ...deleteChanges,
  ]
}

/** Build attribute changes that make latest metadata match selected metadata, including removals. */
export function buildRestoreMetadataChanges(
  latestMetadata: HMMetadata,
  selectedMetadata: HMMetadata,
): DocumentChange[] {
  const changes: DocumentChange[] = []

  for (const key of metadataStringKeys) {
    pushMetadataValueChange(changes, [key], latestMetadata[key], selectedMetadata[key])
  }
  for (const key of metadataBoolKeys) {
    pushMetadataValueChange(changes, [key], latestMetadata[key], selectedMetadata[key])
  }
  pushMetadataValueChange(
    changes,
    ['theme', 'headerLayout'],
    latestMetadata.theme?.headerLayout,
    selectedMetadata.theme?.headerLayout,
  )

  return changes
}

function pushMetadataValueChange(
  changes: DocumentChange[],
  key: string[],
  latestValue: unknown,
  selectedValue: unknown,
) {
  if (latestValue === selectedValue) return
  if (typeof selectedValue === 'string') {
    changes.push(attributeChange(key, {case: 'stringValue', value: selectedValue}))
    return
  }
  if (typeof selectedValue === 'boolean') {
    changes.push(attributeChange(key, {case: 'boolValue', value: selectedValue}))
    return
  }
  if (selectedValue === undefined || selectedValue === null) {
    if (latestValue !== undefined && latestValue !== null) {
      changes.push(attributeChange(key, {case: 'nullValue', value: new Empty()}))
    }
  }
}

function attributeChange(
  key: string[],
  value: {case: 'stringValue'; value: string} | {case: 'boolValue'; value: boolean} | {case: 'nullValue'; value: Empty},
) {
  return new DocumentChange({
    op: {
      case: 'setAttribute',
      value: new DocumentChange_SetAttribute({
        blockId: '',
        key,
        value,
      }),
    },
  })
}
