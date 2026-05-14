import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {useMemo} from 'react'
import {compareBlocksWithMap, createBlocksMap, extractDeletes} from '../utils/document-changes'
import {getNavigationChanges} from '../utils/navigation-changes'
import {useEditorHandlersRef} from './editor-handlers-context'
import {
  selectDocument,
  selectEditorBaseline,
  selectMetadata,
  selectNavigation,
  selectSaveStatus,
  useDocumentSelector,
} from './use-document-machine'

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
  const saveStatus = useDocumentSelector(selectSaveStatus)

  return useMemo(() => {
    const metadataChangeCount = Object.keys(metadata ?? {}).length
    // Site-header nav edits don't touch the editor or metadata, so count
    // them via the same diff used at publish time. `navigation === undefined`
    // means no nav edits this session — return 0 ops.
    const navigationChangeCount = getNavigationChanges(navigation, publishedDoc?.detachedBlocks?.navigation).length
    if (!baseline) return metadataChangeCount + navigationChangeCount
    const editorBlocks = handlersRef.current?.getCurrentBlocks() ?? []
    if (editorBlocks.length === 0) return metadataChangeCount + navigationChangeCount
    const baselineMap = createBlocksMap(editorBlocksToHMBlockNodes(baseline), '')
    const {changes, touchedBlocks} = compareBlocksWithMap(baselineMap, editorBlocks, '')
    const deletes = extractDeletes(baselineMap, touchedBlocks)
    return changes.length + deletes.length + metadataChangeCount + navigationChangeCount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, metadata, navigation, publishedDoc, saveStatus, handlersRef])
}
