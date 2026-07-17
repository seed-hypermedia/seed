import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {useMemo} from 'react'
import {compareBlocksWithMap, createBlocksMap, extractDeletes} from '../utils/document-changes'
import {getNavigationChanges} from '../utils/navigation-changes'
import {useEditorHandlersRef} from './editor-handlers-context'
import {
  selectBlocks,
  selectDocument,
  selectDraftId,
  selectEditorBaseline,
  selectMetadata,
  selectNavigation,
  selectSaveStatus,
  useDocumentSelector,
} from './use-document-machine'

/**
 * A paragraph counts as "empty" when it has no inline content at all, or its
 * inline content is only empty text nodes. The live editor represents an empty
 * trailing paragraph as `content: []`, but the same block round-tripped through
 * `hmBlocksToEditorContent` (i.e. loaded back from a published document) comes
 * back as `content: [{type: 'text', text: '', ...}]`. Both must be treated as
 * empty, otherwise the two representations diff against each other and produce a
 * phantom "delete" that never clears — leaving the Publish button green forever
 * after a publish.
 */
function isEmptyEditorContent(content: EditorBlock['content']): boolean {
  if (!content || (Array.isArray(content) && content.length === 0)) return true
  if (!Array.isArray(content)) return false
  return content.every((item: any) => item?.type === 'text' && (item.text ?? '') === '')
}

function removeTrailingEmptyParagraphs(blocks: EditorBlock[]): EditorBlock[] {
  const trimmed = [...blocks]
  while (true) {
    const lastBlock = trimmed[trimmed.length - 1]
    if (!lastBlock) break
    if (lastBlock.type !== 'paragraph') break
    if (lastBlock.children.length !== 0) break
    if (!isEmptyEditorContent(lastBlock.content)) break
    trimmed.pop()
  }
  return trimmed
}

/**
 * Count of unpublished changes: block diffs against the editor baseline plus
 * any metadata fields touched this session (title, summary, etc.). Reads
 * `editor.topLevelBlocks` via `EditorHandlersContext` and re-runs whenever
 * `selectSaveStatus` ticks.
 *
 * Lifted from `frontend/apps/desktop/src/components/editing-toolbar.tsx` so
 * the web-side editing toolbar can reuse the same diff logic.
 */
export function useUnpublishedChangeCount(): number {
  const handlersRef = useEditorHandlersRef()
  const baseline = useDocumentSelector(selectEditorBaseline)
  const metadata = useDocumentSelector(selectMetadata)
  const navigation = useDocumentSelector(selectNavigation)
  const publishedDoc = useDocumentSelector(selectDocument)
  const draftId = useDocumentSelector(selectDraftId)
  const blocks = useDocumentSelector(selectBlocks)
  const saveStatus = useDocumentSelector(selectSaveStatus)

  return useMemo(() => {
    const metadataChangeCount = Object.keys(metadata ?? {}).length
    // Site-header nav edits don't touch the editor or metadata, so count
    // them via the same diff used at publish time. `navigation === undefined`
    // means no nav edits this session — return 0 ops.
    const navigationChangeCount = getNavigationChanges(navigation, publishedDoc?.detachedBlocks?.navigation).length
    const publishedBaseline = removeTrailingEmptyParagraphs(
      hmBlocksToEditorContent(publishedDoc?.content ?? [], {childrenType: 'Group'}),
    )
    const diffBaseline = removeTrailingEmptyParagraphs(draftId ? publishedBaseline : baseline ?? publishedBaseline)
    if (!diffBaseline.length) {
      const editorBlocks = removeTrailingEmptyParagraphs(
        handlersRef.current?.getCurrentBlocks() ?? hmBlocksToEditorContent(blocks),
      )
      return editorBlocks.length + metadataChangeCount + navigationChangeCount
    }
    const editorBlocks = removeTrailingEmptyParagraphs(
      handlersRef.current?.getCurrentBlocks() ?? hmBlocksToEditorContent(blocks),
    )
    if (editorBlocks.length === 0) return metadataChangeCount + navigationChangeCount
    const baselineMap = createBlocksMap(editorBlocksToHMBlockNodes(diffBaseline), '')
    const {changes, touchedBlocks} = compareBlocksWithMap(baselineMap, editorBlocks, '')
    const deletes = extractDeletes(baselineMap, touchedBlocks)
    return changes.length + deletes.length + metadataChangeCount + navigationChangeCount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, metadata, navigation, publishedDoc, draftId, blocks, saveStatus, handlersRef])
}
