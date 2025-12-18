import {useSearchParams} from '@remix-run/react'
import {
  HMDocument,
  HMMetadata,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useDirectory, useResource} from '@shm/shared/models/entity'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {DocNavigationItem, getSiteNavDirectory} from '@shm/ui/navigation'
import {AutoHideSiteHeaderClassName, SiteHeader} from '@shm/ui/site-header'

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
}

export function WebSiteHeader({
  origin,
  ...props
}: React.PropsWithChildren<WebSiteHeaderProps>) {
  const [searchParams] = useSearchParams()

  const homeResourceQuery = useResource(props.siteHomeId)
  const homeDirectoryQuery = useDirectory(props.siteHomeId)

  const isCenterLayout =
    props.homeMetadata?.theme?.headerLayout === 'Center' ||
    props.homeMetadata?.layout === 'Seed/Experimental/Newspaper'

  const homeDocFromQuery =
    homeResourceQuery.data?.type === 'document'
      ? homeResourceQuery.data.document
      : null

  const navigationBlockNode = homeDocFromQuery?.detachedBlocks?.navigation
  console.log('navigationBlockNode', navigationBlockNode)

  const homeNavigationItems: DocNavigationItem[] = navigationBlockNode
    ? navigationBlockNode.children
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
          }
        })
        .filter((item) => !!item) || []
    : []

  const directoryResults = homeDirectoryQuery.data
  const directoryItems = props.siteHomeId
    ? getSiteNavDirectory({
        id: props.siteHomeId,
        directory: directoryResults ?? undefined,
      })
    : []

  // For header menu: use home nav items if available, otherwise directory items
  const items: DocNavigationItem[] =
    homeNavigationItems.length > 0 ? homeNavigationItems : directoryItems

  return (
    <>
      {origin &&
      props.siteHomeId &&
      props.siteHomeId.uid !== props.originHomeId.uid ? (
        <HypermediaHostBanner origin={origin} />
      ) : null}
      <SiteHeader
        {...props}
        siteHomeDocument={homeDocFromQuery}
        hideSiteBarClassName={props.hideSiteBarClassName}
        isCenterLayout={isCenterLayout}
        items={items}
        homeNavigationItems={homeNavigationItems}
        directoryItems={directoryItems}
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
        isMainFeedVisible={searchParams.get('feed') === 'true'}
        wrapperClassName="fixed sm:static"
        notifyServiceHost={NOTIFY_SERVICE_HOST}
      />
    </>
  )
}
