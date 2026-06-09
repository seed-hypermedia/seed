import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {
  HMBlockNode,
  HMDocumentInfo,
  HMListedDraft,
  HMMetadata,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  editorBlocksToHMBlockNodes,
  extractAllContentRefs,
  getMetadataName,
  hasQueryBlockTargetingSelf,
  hmId,
  useRouteLink,
} from '@shm/shared'
import {useCanSeePrivateDocs} from '@shm/shared/models/capabilities'
import {useDraftsForAccountSafe, type HMListedDraftWithLocation} from '@shm/shared/draft-breadcrumb-context'
import {collectChildDraftIds} from '@shm/shared/utils/child-draft-refs'
import {useMemo} from 'react'
import {DocumentListItem} from './document-list-item'
import {Button} from './button'
import {DraftBadge} from './draft-badge'
import {SizableText} from './text'

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
  const drafts = useDraftsForAccountSafe(docId.uid)

  const {unreferencedDocs, unreferencedDrafts} = useMemo(() => {
    const sourceContent = draftContent && draftContent.length > 0 ? toHMBlockNodes(draftContent) : content

    if (hasQueryBlockTargetingSelf(sourceContent, docId.uid, docId.path)) {
      return {unreferencedDocs: [], unreferencedDrafts: []}
    }

    const allRefs = extractAllContentRefs(sourceContent)
    const referencedIds = new Set<string>()
    allRefs.forEach((ref) => {
      if (ref.refId) {
        referencedIds.add(ref.refId.id)
      }
    })
    const referencedDraftIds = new Set(collectChildDraftIds(sourceContent))

    const unreferencedDocs = (directory ?? [])
      .filter((child) => canSeePrivate || child.visibility !== 'PRIVATE')
      .filter((child) => !referencedIds.has(child.id.id))

    const currentPath = docId.path ?? []
    const unreferencedDrafts = (drafts.data ?? [])
      .filter((draft) => draft.locationId?.uid === docId.uid)
      .filter((draft) => pathEquals(draft.locationId?.path ?? [], currentPath))
      .filter((draft) => !draft.editId)
      .filter((draft) => canSeePrivate || draft.visibility !== 'PRIVATE')
      .filter((draft) => !referencedDraftIds.has(draft.id))

    return {unreferencedDocs, unreferencedDrafts}
  }, [content, draftContent, directory, drafts.data, docId.uid, docId.path, canSeePrivate])

  if (unreferencedDocs.length === 0 && unreferencedDrafts.length === 0) return null

  return (
    <div className="mt-8 border-t pt-4 pb-16">
      <div className="flex flex-col gap-1">
        {unreferencedDocs.map((item) => (
          <DocumentListItem key={item.id.id} item={item} />
        ))}
        {unreferencedDrafts.map((draft) => (
          <UnreferencedDraftListItem key={draft.id} draft={draft} />
        ))}
      </div>
    </div>
  )
}

function pathEquals(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  return a.every((segment, index) => segment === b[index])
}

function UnreferencedDraftListItem({draft}: {draft: HMListedDraftWithLocation | HMListedDraft}) {
  const locationId = 'locationId' in draft ? draft.locationId : undefined
  const linkProps = useRouteLink(
    locationId
      ? {key: 'document', id: hmId(locationId.uid, {path: [...(locationId.path ?? []), `-${draft.id}`]})}
      : {key: 'draft', id: draft.id},
  )
  return (
    <Button
      asChild
      variant="ghost"
      className="h-auto w-full items-center justify-start border-none bg-transparent bg-white px-4 py-2 shadow-sm hover:shadow-md dark:bg-black"
    >
      <a {...linkProps}>
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          <SizableText className="truncate text-left font-sans">
            {getMetadataName(draft.metadata as HMMetadata)}
          </SizableText>
          <DraftBadge />
        </div>
      </a>
    </Button>
  )
}
