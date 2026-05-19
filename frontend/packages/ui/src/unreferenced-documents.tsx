import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {HMBlockNode, HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {editorBlocksToHMBlockNodes, extractAllContentRefs, hasQueryBlockTargetingSelf} from '@shm/shared'
import {useCanSeePrivateDocs} from '@shm/shared/models/capabilities'
import {useMemo} from 'react'
import {DocumentListItem} from './document-list-item'

function toHMBlockNodes(blocks: EditorBlock[] | HMBlockNode[]): HMBlockNode[] {
  const first = blocks[0]
  const isEditorFormat = first != null && 'type' in first && !('block' in first)
  return isEditorFormat ? editorBlocksToHMBlockNodes(blocks as EditorBlock[]) : (blocks as HMBlockNode[])
}

/** Renders child documents that are not referenced by the current document content. */
export function UnreferencedDocuments({
  docId,
  content,
  draftContent,
  directory,
}: {
  docId: UnpackedHypermediaId
  content: HMBlockNode[]
  draftContent?: EditorBlock[] | HMBlockNode[]
  directory: HMDocumentInfo[] | undefined
}) {
  const canSeePrivate = useCanSeePrivateDocs(docId)

  const unreferencedDocs = useMemo(() => {
    if (!directory || directory.length === 0) return []

    const sourceContent = draftContent && draftContent.length > 0 ? toHMBlockNodes(draftContent) : content

    if (hasQueryBlockTargetingSelf(sourceContent, docId.uid, docId.path)) {
      return []
    }

    const allRefs = extractAllContentRefs(sourceContent)
    const referencedIds = new Set<string>()
    allRefs.forEach((ref) => {
      if (ref.refId) {
        referencedIds.add(ref.refId.id)
      }
    })

    return directory
      .filter((child) => canSeePrivate || child.visibility !== 'PRIVATE')
      .filter((child) => !referencedIds.has(child.id.id))
  }, [content, draftContent, directory, docId.uid, docId.path, canSeePrivate])

  if (unreferencedDocs.length === 0) return null

  return (
    <div className="mt-8 border-t pt-4 pb-16">
      <div className="flex flex-col gap-1">
        {unreferencedDocs.map((item) => (
          <DocumentListItem key={item.id.id} item={item} />
        ))}
      </div>
    </div>
  )
}
