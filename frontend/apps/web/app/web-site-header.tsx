import {
  hmId,
  HMLoadedDocument,
  HMMetadata,
  HMQueryResult,
  normalizeDate,
  UnpackedHypermediaId,
} from '@shm/shared'
import {SiteHeader} from '@shm/ui/site-header'

export function WebSiteHeader(
  props: React.PropsWithChildren<{
    homeMetadata: HMMetadata | undefined
    originHomeId: UnpackedHypermediaId | null
    docId: UnpackedHypermediaId | null
    homeId: UnpackedHypermediaId
    document?: HMLoadedDocument
    origin?: string
    rootQuery?: HMQueryResult
  }>,
) {
  const isCenterLayout = props.homeMetadata?.theme?.headerLayout === 'Center'
  const items = props.rootQuery?.results
    ?.filter((item) => {
      return item.path.length === 1
    })
    ?.map((item) => {
      const sortTime = normalizeDate(item.createTime)
      if (!sortTime) return null
      return {
        isPublished: true,
        isDraft: false,
        id: hmId('d', item.account, {path: item.path}),
        sortTime,
        metadata: item.metadata,
      }
    })
    .filter((item) => !!item)
  items?.sort((a, b) => b.sortTime.getTime() - a.sortTime.getTime()).reverse()

  return (
    <SiteHeader
      {...props}
      isCenterLayout={isCenterLayout}
      items={items}
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
    />
  )
}
