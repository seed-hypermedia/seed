import {useDraft} from '@/models/accounts'
import {client} from '@/trpc'
import {HMBlockNode, HMDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {editorBlockToHMBlock} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {PreviewRoute} from '@shm/shared/routes'
import '@shm/shared/styles/document.css'
import {useResource} from '@shm/shared/models/entity'
import {DocumentMachineProvider} from '@shm/shared/models/use-document-machine'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {DocumentEditor} from '@shm/editor/document-editor'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {DocumentCover} from '@shm/ui/document-cover'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {useDocumentLayout} from '@shm/ui/layout'
import {PreviewBanner} from '@shm/ui/preview-banner'
import {ResourcePage} from '@shm/ui/resource-page-common'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {useCallback, useMemo} from 'react'

// Convert flat EditorBlock array to tree HMBlockNode array
// Gracefully handles unsupported block types by rendering them as paragraphs with a message
function editorBlocksToBlockNodes(editorBlocks: EditorBlock[]): HMBlockNode[] {
  return editorBlocks
    .map((block) => {
      try {
        return {
          block: editorBlockToHMBlock(block),
          children: block.children ? editorBlocksToBlockNodes(block.children) : undefined,
        }
      } catch (error) {
        // Return a fallback paragraph block for unsupported types
        console.warn(`Preview: Unsupported block type "${block.type}"`, error)
        return {
          block: {
            id: block.id,
            type: 'Paragraph' as const,
            text: `[Unsupported block type: ${block.type}]`,
            annotations: [],
            attributes: {},
          },
          children: block.children ? editorBlocksToBlockNodes(block.children) : undefined,
        }
      }
    })
    .filter(Boolean) as HMBlockNode[]
}

export default function PreviewPage() {
  const route = useNavRoute() as PreviewRoute
  if (route.key !== 'preview') throw new Error('PreviewPage requires preview route')

  // Published document preview mode — render full page layout
  if (route.docId) {
    return <PublishedPreview docId={route.docId} />
  }

  // Draft preview mode (original behavior)
  const {data: draft, isLoading} = useDraft(route.draftId)

  if (isLoading) {
    return (
      <div className={cn(panelContainerStyles, 'flex items-center justify-center')}>
        <Spinner className="size-8" />
      </div>
    )
  }

  if (!draft) {
    return (
      <div className={cn(panelContainerStyles, 'flex items-center justify-center')}>
        <SizableText>Draft not found</SizableText>
      </div>
    )
  }

  return <PreviewContent draft={draft} />
}

function PublishedPreview({docId}: {docId: UnpackedHypermediaId}) {
  const handleClose = useCallback(() => {
    const windowId = (window as any).windowId as string
    client.closeAppWindow.mutate(windowId)
  }, [])

  return (
    <div className="relative h-full max-h-full overflow-hidden rounded-lg border bg-white">
      <PreviewBanner
        onClose={handleClose}
        message="You are viewing the current published version of this document"
      />
      <ResourcePage
        docId={docId}
        canEdit={false}
        existingDraft={false}
        DocumentContentComponent={DocumentEditor}
      />
    </div>
  )
}

function PreviewContent({draft}: {draft: HMDraft}) {
  const metadata = draft.metadata
  const hasCover = !!metadata.cover

  const {showSidebars, sidebarProps, wrapperProps} = useDocumentLayout({
    contentWidth: metadata.contentWidth,
    showSidebars: metadata.showOutline,
  })

  const coverUrl = useMemo(() => {
    if (!metadata.cover) return undefined
    return getDaemonFileUrl(metadata.cover)
  }, [metadata.cover])

  const blockNodes = useMemo(() => {
    return editorBlocksToBlockNodes(draft.content as EditorBlock[])
  }, [draft.content])

  const handleClose = useCallback(() => {
    // windowId is set by preload script
    const windowId = (window as any).windowId as string
    client.closeAppWindow.mutate(windowId)
  }, [])

  const resourceId = {
    id: draft.id,
    uid: draft.locationUid || draft.editUid || '',
    path: draft.locationPath || draft.editPath || null,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
  }

  return (
    <DocumentMachineProvider input={{documentId: resourceId, canEdit: false}}>
      <div className={cn(panelContainerStyles)}>
        <PreviewBanner onClose={handleClose} />
        <ScrollArea className="h-full">
          {hasCover && coverUrl ? <DocumentCover cover={coverUrl} /> : null}
          <Container>
            <div {...wrapperProps}>
              <div className="min-w-0 flex-1">
                {/* Title */}
                <div className={cn('mb-6', hasCover ? 'mt-4' : 'mt-12')}>
                  <SizableText size="4xl" weight="bold" asChild>
                    <h1>{metadata.name || 'Untitled'}</h1>
                  </SizableText>
                </div>

                {/* Content */}
                <DocumentEditor
                  blocks={blockNodes}
                  resourceId={resourceId}
                />
              </div>

              {/* Navigation sidebar placeholder for layout consistency */}
              {showSidebars ? <div {...sidebarProps} /> : null}
            </div>
          </Container>
        </ScrollArea>
      </div>
    </DocumentMachineProvider>
  )
}
