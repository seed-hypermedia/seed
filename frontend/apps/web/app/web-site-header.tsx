import {
  HMDocument,
  HMEntityContent,
  hmId,
  HMMetadata,
  HMQueryResult,
  normalizeDate,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {DocNavigationItem} from '@shm/ui/navigation'
import {AutoHideSiteHeaderClassName, SiteHeader} from '@shm/ui/site-header'
import {useSearchParams} from '@remix-run/react'

export function WebSiteHeader(
  props: React.PropsWithChildren<{
    noScroll?: boolean
    homeMetadata: HMMetadata | null
    originHomeId: UnpackedHypermediaId | null
    docId: UnpackedHypermediaId | null
    document?: HMDocument
    supportDocuments?: HMEntityContent[]
    supportQueries?: HMQueryResult[]
    origin?: string
    isLatest?: boolean
    hideSiteBarClassName?: AutoHideSiteHeaderClassName
  }>,
) {
  const [searchParams, setSearchParams] = useSearchParams()
  const isCenterLayout =
    props.homeMetadata?.theme?.headerLayout === 'Center' ||
    props.homeMetadata?.layout === 'Seed/Experimental/Newspaper'
  const homeDocument =
    props.document?.path === ''
      ? props.document
      : props.supportDocuments?.find(
          (doc) =>
            props.docId?.uid &&
            doc.id.uid === props.docId?.uid &&
            !doc.id.path?.length,
        )?.document
  const navigationBlockNode = homeDocument?.detachedBlocks?.navigation

  // Home navigation items from the navigation block
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

  // Directory items for current document (only when not on home)
  const isHomeDoc = props.docId?.path?.length === 0
  const directoryItems = isHomeDoc ? [] : getDirectoryItems(props)

  // For header menu: use home nav items if available, otherwise directory items
  const items: DocNavigationItem[] =
    homeNavigationItems.length > 0
      ? homeNavigationItems
      : getDirectoryItems(props)

  return (
    <SiteHeader
      noScroll={props.noScroll}
      hideSiteBarClassName={props.hideSiteBarClassName}
      {...props}
      isCenterLayout={isCenterLayout}
      items={items}
      homeNavigationItems={homeNavigationItems}
      directoryItems={directoryItems}
      origin={props.origin}
      onBlockFocus={(blockId) => {
        window.location.hash = blockId
        const element = document.getElementById(blockId)
        if (element) {
          element.scrollIntoView({behavior: 'smooth'})
        }
      }}
      onShowMobileMenu={(open) => {
        if (open) {
          document.body.style.overflow = 'hidden'
        } else {
          document.body.style.overflow = 'auto'
        }
      }}
      handleToggleFeed={() => {
        const currentFeed = searchParams.get('feed') === 'true'
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev)
          if (currentFeed) {
            newParams.delete('feed')
          } else {
            newParams.set('feed', 'true')
          }
          return newParams
        })
      }}
      isMainFeedVisible={searchParams.get('feed') === 'true'}
    />
  )
}

function getDirectoryItems(props: {
  supportQueries?: HMQueryResult[] | undefined
  docId: UnpackedHypermediaId | null
}): DocNavigationItem[] {
  const supportQuery = props.supportQueries?.find(
    (q) => q.in.uid === props.docId?.uid && !q.in.path?.length,
  )
  const directoryItems = supportQuery?.results
    ?.filter((item) => {
      return item.path.length === 1
    })
    ?.map((item) => {
      const sortTime = normalizeDate(item.createTime)
      if (!sortTime) return null
      return {
        isPublished: true,
        isDraft: false,
        key: item.path.join('/'),
        id: hmId(item.account, {path: item.path}),
        sortTime,
        metadata: item.metadata,
      }
    })
    .filter((item) => !!item)
  directoryItems
    ?.sort((a, b) => b.sortTime.getTime() - a.sortTime.getTime())
    .reverse()
  // @ts-expect-error
  return directoryItems
}
