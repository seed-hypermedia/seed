import {useDocumentCitations} from '@/models/citations'
import {useContactsMetadata} from '@/models/contacts'
import {AppDocContentProvider} from '@/pages/document-content-provider'

import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {DocumentDiscussionsAccessory} from '@shm/shared/routes'
import {useTxString} from '@shm/shared/translation'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {
  CommentDiscussions,
  Discussions,
  EmptyDiscussions,
  QuotedDocBlock,
} from '@shm/ui/comments'
import {Spinner} from '@shm/ui/spinner'
import {memo} from 'react'
import {AccessoryContent} from './accessory-sidebar'
import {CommentCitationEntry} from './citations-panel'
import {CommentBox, renderCommentContent} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel(props: {
  docId: UnpackedHypermediaId
  accessory: DocumentDiscussionsAccessory
  onAccessory: (acc: DocumentDiscussionsAccessory) => void
}) {
  const {docId, accessory, onAccessory} = props
  const homeDoc = useResource(hmId(docId.uid))
  const targetDomain =
    homeDoc.data?.type === 'document'
      ? homeDoc.data.document.metadata.siteUrl
      : undefined

  const commentEditor = (
    <CommentBox docId={docId} commentId={accessory.openComment} />
  )

  if (accessory.openBlockId) {
    return (
      <CommentBlockAccessory
        docId={docId}
        onBack={() => onAccessory({key: 'discussions'})}
        blockId={accessory.openBlockId}
        targetDomain={targetDomain}
      />
    )
  }

  if (accessory.openComment) {
    return (
      <CommentDiscussions
        onBack={() => onAccessory({key: 'discussions'})}
        commentId={accessory.openComment}
        commentEditor={commentEditor}
        targetId={docId}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  return (
    <>
      <Discussions
        commentEditor={commentEditor}
        targetId={docId}
        renderCommentContent={renderCommentContent}
      />
    </>
  )
}

function CommentBlockAccessory({
  docId,
  blockId,
  autoFocus,
  onBack,
  targetDomain,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  autoFocus?: boolean
  onBack: () => void
  targetDomain?: string
}) {
  const tx = useTxString()
  const citations = useDocumentCitations(docId)
  const citationsForBlock = citations.data?.filter((citation) => {
    return (
      citation.targetFragment?.blockId === blockId &&
      citation.source.type == 'c'
    )
  })
  const accountIds = new Set<string>()
  citationsForBlock?.forEach((citation) => {
    citation.source.author && accountIds.add(citation.source.author)
  })
  const doc = useResource(docId)
  const accounts = useContactsMetadata(Array.from(accountIds))
  let quotedContent = null

  if (!docId) return null

  if (doc.data?.type == 'document' && doc.data.document) {
    quotedContent = (
      <QuotedDocBlock docId={docId} blockId={blockId} doc={doc.data.document} />
    )
  } else if (doc.isInitialLoading) {
    quotedContent = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  let panelContent = null
  if (citations.data) {
    panelContent =
      citationsForBlock && citationsForBlock.length > 0 ? (
        citationsForBlock?.map((citation) => {
          return (
            <CommentCitationEntry
              citation={citation}
              key={citation.source.id.id}
              accounts={accounts}
              targetDomain={targetDomain}
            />
          )
        })
      ) : (
        <EmptyDiscussions emptyReplies />
      )
  }
  return (
    <AccessoryContent
      footer={<CommentBox docId={docId} quotingBlockId={blockId} />}
    >
      <AccessoryBackButton onClick={onBack} label={tx('All Discussions')} />
      <AppDocContentProvider docId={docId}>
        {quotedContent}
      </AppDocContentProvider>
      {panelContent}
    </AccessoryContent>
  )
}
