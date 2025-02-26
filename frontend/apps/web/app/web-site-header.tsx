import {
  HMDocument,
  HMEntityContent,
  hmId,
  HMMetadata,
  HMQueryResult,
  normalizeDate,
  UnpackedHypermediaId,
} from '@shm/shared'
import {SiteHeader} from '@shm/ui/site-header'

export function WebSiteHeader(
  props: React.PropsWithChildren<{
    homeMetadata: HMMetadata | null
    originHomeId: UnpackedHypermediaId | null
    docId: UnpackedHypermediaId | null
    document?: HMDocument
    supportDocuments?: HMEntityContent[]
    supportQueries?: HMQueryResult[]
    origin?: string
  }>,
) {
  const isCenterLayout =
    props.homeMetadata?.theme?.headerLayout === 'Center' ||
    props.homeMetadata?.layout === 'Seed/Experimental/Newspaper'
  const supportQuery = props.supportQueries?.find(
    (q) => q.in.uid === props.docId?.uid && !q.in.path?.length,
  )
  const items = supportQuery?.results
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
      isCenterLayout={isCenterLayout}
      items={items}
      {...props}
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
