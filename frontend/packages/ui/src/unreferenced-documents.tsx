// import {EditorBlock} from '@seed-hypermedia/client/editor-types'
// import {HMBlockNode, HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
// import {editorBlocksToHMBlockNodes, extractAllContentRefs, hasQueryBlockTargetingSelf} from '@shm/shared'
// import {useCanSeePrivateDocs} from '@shm/shared/models/capabilities'
// import {ChevronDown, ChevronRight} from 'lucide-react'
// import {useMemo, useState} from 'react'
// import {DocumentListItem} from './document-list-item'
// import {cn} from './utils'

// function toHMBlockNodes(blocks: EditorBlock[] | HMBlockNode[]): HMBlockNode[] {
//   const first = blocks[0]
//   const isEditorFormat = first != null && 'type' in first && !('block' in first)
//   return isEditorFormat ? editorBlocksToHMBlockNodes(blocks as EditorBlock[]) : (blocks as HMBlockNode[])
// }

// export function UnreferencedDocuments({
//   docId,
//   content,
//   draftContent,
//   directory,
// }: {
//   docId: UnpackedHypermediaId
//   content: HMBlockNode[]
//   draftContent?: EditorBlock[] | HMBlockNode[]
//   directory: HMDocumentInfo[] | undefined
// }) {
//   const [isExpanded, setIsExpanded] = useState(false)
//   const canSeePrivate = useCanSeePrivateDocs(docId)

//   const unreferencedDocs = useMemo(() => {
//     if (!directory || directory.length === 0) return []

//     const sourceContent = draftContent && draftContent.length > 0 ? toHMBlockNodes(draftContent) : content

//     if (hasQueryBlockTargetingSelf(sourceContent, docId.uid, docId.path)) {
//       return []
//     }

//     const allRefs = extractAllContentRefs(sourceContent)
//     const referencedIds = new Set<string>()
//     allRefs.forEach((ref) => {
//       if (ref.refId) {
//         referencedIds.add(ref.refId.id)
//       }
//     })

//     return directory
//       .filter((child) => canSeePrivate || child.visibility !== 'PRIVATE')
//       .filter((child) => !referencedIds.has(child.id.id))
//   }, [content, draftContent, directory, docId.uid, docId.path, canSeePrivate])

//   if (unreferencedDocs.length === 0) return null

//   return (
//     <div className="mt-8 border-t pt-4 pb-16">
//       <button
//         onClick={() => setIsExpanded(!isExpanded)}
//         className={cn(
//           'text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-2 text-sm transition-colors',
//         )}
//       >
//         {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
//         Unreferenced Documents ({unreferencedDocs.length})
//       </button>
//       {isExpanded && (
//         <div className="flex flex-col gap-1 pt-2">
//           {unreferencedDocs.map((item) => (
//             <DocumentListItem key={item.id.id} item={item} />
//           ))}
//         </div>
//       )}
//     </div>
//   )
// }
