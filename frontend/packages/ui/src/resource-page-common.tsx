import {
  hmId,
  HMDocument,
  unpackHmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useDirectory, useResource} from '@shm/shared/models/entity'
import {BlocksContent, BlocksContentProvider} from './blocks-content'
import {ScrollArea} from './components/scroll-area'
import {DocumentCover} from './document-cover'
import {DocumentHeader} from './document-header'
import {useDocumentLayout} from './layout'
import {DocNavigationItem, getSiteNavDirectory} from './navigation'
import {
  PageDeleted,
  PageDiscovery,
  PageNotFound,
} from './page-message-states'
import {SiteHeader} from './site-header'
import {Spinner} from './spinner'
import {cn} from './utils'

export interface ResourcePageProps {
  docId: UnpackedHypermediaId
}

export function ResourcePage({docId}: ResourcePageProps) {
  // Load document data via React Query (pre-hydrated on web)
  const resource = useResource(docId, {
    subscribed: true,
    recursive: true,
  })

  // Load home site entity for header (always load this so header can show)
  const siteHomeId = hmId(docId.uid)
  const siteHomeResource = useResource(siteHomeId, {subscribed: true})
  const homeDirectory = useDirectory(siteHomeId)

  const siteHomeDocument =
    siteHomeResource.data?.type === 'document'
      ? siteHomeResource.data.document
      : null

  // Compute header data
  const headerData = computeHeaderData(siteHomeId, siteHomeDocument, homeDirectory.data)

  // Handle loading state
  if (resource.isInitialLoading) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </PageWrapper>
    )
  }

  // Handle discovery state
  if (resource.isDiscovering) {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageDiscovery />
      </PageWrapper>
    )
  }

  // Handle not-found
  if (!resource.data || resource.data.type === 'not-found') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageNotFound />
      </PageWrapper>
    )
  }

  // Handle tombstone (deleted)
  if (resource.isTombstone || resource.data.type === 'tombstone') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageDeleted />
      </PageWrapper>
    )
  }

  // Handle error
  if (resource.data.type === 'error') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="text-destructive">{resource.data.message}</div>
        </div>
      </PageWrapper>
    )
  }

  // Handle redirect - for now just show not found, redirect handling comes later
  if (resource.data.type === 'redirect') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageNotFound />
      </PageWrapper>
    )
  }

  // Success: render document
  if (resource.data.type !== 'document') {
    return (
      <PageWrapper siteHomeId={siteHomeId} docId={docId} headerData={headerData}>
        <PageNotFound />
      </PageWrapper>
    )
  }
  const document = resource.data.document

  return (
    <PageWrapper
      siteHomeId={siteHomeId}
      docId={docId}
      headerData={headerData}
      document={document}
    >
      <DocumentBody docId={docId} document={document} />
    </PageWrapper>
  )
}

// Header data computed from site home document
interface HeaderData {
  items: DocNavigationItem[]
  homeNavigationItems: DocNavigationItem[]
  directoryItems: DocNavigationItem[]
  isCenterLayout: boolean
  siteHomeDocument: HMDocument | null
}

function computeHeaderData(
  siteHomeId: UnpackedHypermediaId,
  siteHomeDocument: HMDocument | null,
  directory: ReturnType<typeof useDirectory>['data'],
): HeaderData {
  // Compute navigation items from home document's navigation block
  const navigationBlockNode = siteHomeDocument?.detachedBlocks?.navigation
  const homeNavigationItems: DocNavigationItem[] = navigationBlockNode
    ? (navigationBlockNode.children
        ?.map((child) => {
          const linkBlock = child.block.type === 'Link' ? child.block : null
          if (!linkBlock) return null
          const id = unpackHmId(linkBlock.link)
          return {
            isPublished: true,
            isDraft: false,
            key: linkBlock.id,
            metadata: {name: linkBlock.text || ''},
            id: id || undefined,
            webUrl: id ? undefined : linkBlock.link,
          } as DocNavigationItem
        })
        .filter((item): item is DocNavigationItem => item !== null) ?? [])
    : []

  const directoryItems = getSiteNavDirectory({
    id: siteHomeId,
    directory: directory ?? undefined,
  })

  const items =
    homeNavigationItems.length > 0 ? homeNavigationItems : directoryItems

  const isCenterLayout =
    siteHomeDocument?.metadata?.theme?.headerLayout === 'Center' ||
    siteHomeDocument?.metadata?.layout === 'Seed/Experimental/Newspaper'

  return {
    items,
    homeNavigationItems,
    directoryItems,
    isCenterLayout,
    siteHomeDocument,
  }
}

// Wrapper that renders SiteHeader + content
function PageWrapper({
  siteHomeId,
  docId,
  headerData,
  document,
  children,
}: {
  siteHomeId: UnpackedHypermediaId
  docId: UnpackedHypermediaId
  headerData: HeaderData
  document?: HMDocument
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex h-full flex-col')}>
      <SiteHeader
        siteHomeId={siteHomeId}
        docId={docId}
        items={headerData.items}
        homeNavigationItems={headerData.homeNavigationItems}
        directoryItems={headerData.directoryItems}
        isCenterLayout={headerData.isCenterLayout}
        document={document}
        siteHomeDocument={headerData.siteHomeDocument}
        isMainFeedVisible={false}
      />
      {children}
    </div>
  )
}

// Document body with content
function DocumentBody({
  docId,
  document,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
}) {
  const isHomeDoc = !docId.path?.length

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    wrapperProps,
    contentMaxWidth,
  } = useDocumentLayout({
    contentWidth: document.metadata?.contentWidth,
    showSidebars: !isHomeDoc && document.metadata?.showOutline !== false,
  })

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" ref={elementRef}>
      <ScrollArea className="flex-1">
        <DocumentCover cover={document.metadata?.cover} />

        <div
          className={cn('mx-auto flex w-full flex-col px-4', isHomeDoc && 'mt-6')}
          style={{maxWidth: contentMaxWidth}}
        >
          {!isHomeDoc && (
            <DocumentHeader
              docId={docId}
              docMetadata={document.metadata}
              authors={[]}
              updateTime={document.updateTime}
            />
          )}
        </div>

        <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
          {showSidebars && (
            <div {...sidebarProps}>{/* Document outline - placeholder */}</div>
          )}

          <div {...mainContentProps}>
            <BlocksContentProvider resourceId={docId}>
              <BlocksContent blocks={document.content} />
            </BlocksContentProvider>
          </div>

          {showSidebars && <div {...sidebarProps} />}
        </div>
      </ScrollArea>
    </div>
  )
}
