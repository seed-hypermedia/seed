import {
  extractAllContentRefs,
  hasQueryBlockTargetingSelf,
  HMBlockNode,
  HMDocumentInfo,
  UnpackedHypermediaId,
} from '@shm/shared'
import {ChevronDown, ChevronRight} from 'lucide-react'
import {useMemo, useState} from 'react'
import {DocumentListItem} from './document-list-item'
import {cn} from './utils'

export function UnreferencedDocuments({
  docId,
  content,
  directory,
}: {
  docId: UnpackedHypermediaId
  content: HMBlockNode[]
  directory: HMDocumentInfo[] | undefined
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  const unreferencedDocs = useMemo(() => {
    if (!directory || directory.length === 0) return []

    if (hasQueryBlockTargetingSelf(content, docId.uid, docId.path)) {
      return []
    }

    const allRefs = extractAllContentRefs(content)
    const referencedIds = new Set<string>()
    allRefs.forEach((ref) => {
      if (ref.refId) {
        referencedIds.add(ref.refId.id)
      }
    })

    return directory.filter((child) => !referencedIds.has(child.id.id))
  }, [content, directory, docId.uid, docId.path])

  if (unreferencedDocs.length === 0) return null

  return (
    <div className="mt-8 border-t pt-4 pb-16">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-2 text-sm transition-colors',
        )}
      >
        {isExpanded ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
        Unreferenced Documents ({unreferencedDocs.length})
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-1 pt-2">
          {unreferencedDocs.map((item) => (
            <DocumentListItem key={item.id.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
