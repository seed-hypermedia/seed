import {useState, type ReactNode} from 'react'
import {useNavigate} from '@shm/shared/utils/navigation'
import {SiteFileBrowserLayout} from '@shm/ui/site-file-browser-layout'
import {useWebCanEdit} from './document-edit/use-web-can-edit'
import {useWebCreateDocumentMenuItem} from './web-utils'
import {HMDocument, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@shm/shared'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {DocNavigationItem, isValidSiteHeaderItem} from '@shm/ui/navigation'
import {AutoHideSiteHeaderClassName, SiteHeader} from '@shm/ui/site-header'

/** Picks explicit top-navigation items, returning [] while the home resource is still loading to prevent flash. */
export function resolveNavigationItems({
  isHomeResourceLoading,
  homeNavigationItems,
}: {
  isHomeResourceLoading: boolean
  homeNavigationItems: DocNavigationItem[]
}): DocNavigationItem[] {
  if (isHomeResourceLoading) return []
  return homeNavigationItems
}

export type WebSiteHeaderProps = {
  noScroll?: boolean
  homeMetadata: HMMetadata | null
  originHomeId: UnpackedHypermediaId
  siteHomeId: UnpackedHypermediaId
  docId: UnpackedHypermediaId | null
  document?: HMDocument
  origin?: string
  isLatest?: boolean
  hideSiteBarClassName?: AutoHideSiteHeaderClassName
  rightActions?: React.ReactNode
}

export function WebSiteHeader({origin, ...props}: React.PropsWithChildren<WebSiteHeaderProps>) {
  const homeResourceQuery = useResource(props.siteHomeId)

  const isCenterLayout =
    props.homeMetadata?.theme?.headerLayout === 'Center' || props.homeMetadata?.layout === 'Seed/Experimental/Newspaper'

  const homeDocFromQuery = homeResourceQuery.data?.type === 'document' ? homeResourceQuery.data.document : null

  const navigationBlockNode = homeDocFromQuery?.detachedBlocks?.navigation

  const homeNavigationItems: DocNavigationItem[] = navigationBlockNode
    ? navigationBlockNode.children
        ?.map((child) => {
          const linkBlock = child.block.type === 'Link' ? child.block : null
          if (!linkBlock) return null
          const id = unpackHmId(linkBlock.link)
          const item: DocNavigationItem = {
            isPublished: true,
            key: linkBlock.id,
            metadata: {name: linkBlock.text || ''},
            id: id || undefined,
            webUrl: id ? undefined : linkBlock.link,
          }
          return item
        })
        .filter((item): item is DocNavigationItem => item !== null)
        .filter(isValidSiteHeaderItem) || []
    : []

  const items = resolveNavigationItems({
    isHomeResourceLoading: homeResourceQuery.isLoading,
    homeNavigationItems,
  })

  return (
    <>
      {origin && props.siteHomeId && props.siteHomeId.uid !== props.originHomeId.uid ? (
        <HypermediaHostBanner origin={origin} />
      ) : null}
      <SiteHeader
        {...props}
        siteHomeDocument={homeDocFromQuery}
        hideSiteBarClassName={props.hideSiteBarClassName}
        isCenterLayout={isCenterLayout}
        items={items}
        homeNavigationItems={homeNavigationItems}
        onBlockFocus={(blockId) => {
          const element = document.getElementById(blockId)
          if (element) {
            element.scrollIntoView({behavior: 'smooth', block: 'start'})
          }
        }}
        onShowMobileMenu={(open) => {
          if (open) {
            document.body.style.overflow = 'hidden'
          } else {
            document.body.style.overflow = 'auto'
          }
        }}
        wrapperClassName="fixed sm:static"
        notifyServiceHost={NOTIFY_SERVICE_HOST}
        rightActions={props.rightActions}
      />
    </>
  )
}

/** Gives standalone web pages the same sidebar as document pages. */
export function WebSidebarLayout({siteHomeId, children}: {siteHomeId: UnpackedHypermediaId; children: ReactNode}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()
  const {canEdit, signingAccountId, capability} = useWebCanEdit(siteHomeId)
  const {menuItem, content} = useWebCreateDocumentMenuItem({
    locationId: siteHomeId,
    signingAccountId: signingAccountId ?? undefined,
    canCreate: canEdit && !!signingAccountId,
    capabilityCid: capability && capability.id !== '_owner' ? capability.id : undefined,
  })
  return (
    <>
      <SiteFileBrowserLayout
        siteId={siteHomeId}
        activeDocumentId={null}
        siteName="Site"
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
        createMenuItem={menuItem}
        onNavigate={(id) => {
          setMobileOpen(false)
          navigate({key: 'document', id})
        }}
      >
        <div className="h-full overflow-y-auto">{children}</div>
      </SiteFileBrowserLayout>
      {content}
    </>
  )
}
