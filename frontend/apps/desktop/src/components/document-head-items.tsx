import {hmId} from '@shm/shared'
import {HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResources} from '@shm/shared/models/entity'
import {DonateButton} from '@shm/ui/donate-button'
import {InteractionSummaryItem} from '@shm/ui/interaction-summary'
import {MessageSquare, Sparkle} from 'lucide-react'

export function DocumentHeadItems({
  docId,
  document,
  commentsCount = 0,
  onCommentsClick,
  onFeedClick,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  commentsCount: number
  onCommentsClick: () => void
  onFeedClick: () => void
}) {
  const authors = useResources(
    document.authors.map((author) => hmId(author)) || [],
  )
  return (
    <div className="flex items-center">
      <InteractionSummaryItem
        label="Activity"
        icon={<Sparkle className="text-muted-foreground size-3" />}
        onClick={onFeedClick}
        count={0}
      />
      <InteractionSummaryItem
        label="Comments"
        icon={<MessageSquare className="text-muted-foreground size-3" />}
        onClick={onCommentsClick}
        count={commentsCount}
      />
      <DonateButton
        authors={authors
          .map((author) => {
            // @ts-expect-error
            if (!author.data?.document) return null
            // @ts-expect-error
            return {id: author.data.id, metadata: author.data.document.metadata}
          })
          .filter((a) => !!a)}
        docId={docId}
      />
    </div>
  )
}
