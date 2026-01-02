import {useDraft} from '@/models/accounts'
import {useOpenUrl} from '@/open-url'
import {client} from '@/trpc'
import {editorBlockToHMBlock} from '@shm/shared/client/editorblock-to-hmblock'
import {EditorBlock} from '@shm/shared/editor-types'
import {HMBlockNode, HMDraft} from '@shm/shared/hm-types'
import {PreviewRoute} from '@shm/shared/routes'
import '@shm/shared/styles/document.css'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {BlocksContent, BlocksContentProvider} from '@shm/ui/blocks-content'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {DocumentCover} from '@shm/ui/document-cover'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {useDocumentLayout} from '@shm/ui/layout'
import {PreviewBanner} from '@shm/ui/preview-banner'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {useCallback, useMemo} from 'react'

// Convert flat EditorBlock array to tree HMBlockNode array
function editorBlocksToBlockNodes(editorBlocks: EditorBlock[]): HMBlockNode[] {
  return editorBlocks.map((block) => ({
    block: editorBlockToHMBlock(block),
    children: block.children
      ? editorBlocksToBlockNodes(block.children)
      : undefined,
  }))
}

export default function PreviewPage() {
  const route = useNavRoute() as PreviewRoute
  if (route.key !== 'preview')
    throw new Error('PreviewPage requires preview route')

  const {data: draft, isLoading} = useDraft(route.draftId)

  if (isLoading) {
    return (
      <div
        className={cn(panelContainerStyles, 'flex items-center justify-center')}
      >
        <Spinner className="size-8" />
      </div>
    )
  }

  if (!draft) {
    return (
      <div
        className={cn(panelContainerStyles, 'flex items-center justify-center')}
      >
        <SizableText>Draft not found</SizableText>
      </div>
    )
  }

  return <PreviewContent draft={draft} />
}

function PreviewContent({draft}: {draft: HMDraft}) {
  const openUrl = useOpenUrl()
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

  return (
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
              <BlocksContentProvider
                resourceId={{
                  id: draft.id,
                  uid: draft.locationUid || draft.editUid || '',
                  path: draft.locationPath || draft.editPath || null,
                  version: null,
                  blockRef: null,
                  blockRange: null,
                  hostname: null,
                  scheme: null,
                }}
              >
                <BlocksContent blocks={blockNodes} />
              </BlocksContentProvider>
            </div>

            {/* Navigation sidebar placeholder for layout consistency */}
            {showSidebars ? <div {...sidebarProps} /> : null}
          </div>
        </Container>
      </ScrollArea>
    </div>
  )
}
