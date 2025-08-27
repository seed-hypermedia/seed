import {AppDocContentProvider} from '@/pages/document-content-provider'

import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {DocumentDiscussionsAccessory} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
} from '@shm/ui/comments'
import {memo} from 'react'
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
    <CommentBox
      docId={docId}
      commentId={accessory.openComment}
      quotingBlockId={accessory.openBlockId}
    />
  )

  if (accessory.openBlockId) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: accessory.openBlockId,
    })
    return (
      <AppDocContentProvider docId={targetId}>
        <BlockDiscussions
          targetId={targetId}
          commentEditor={commentEditor}
          onBack={() => onAccessory({key: 'discussions'})}
          targetDomain={targetDomain}
        />
      </AppDocContentProvider>
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
        targetDomain={targetDomain}
      />
    )
  }

  return (
    <>
      <Discussions
        commentEditor={commentEditor}
        targetId={docId}
        renderCommentContent={renderCommentContent}
        targetDomain={targetDomain}
      />
    </>
  )
}
