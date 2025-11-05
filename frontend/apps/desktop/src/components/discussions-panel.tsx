import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useSelectedAccount} from '@/selected-account'
import {useDeleteComment} from '@shm/shared/comments-service-provider'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {
  DocumentAccessory,
  DocumentDiscussionsAccessory,
} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
  useDeleteCommentDialog,
} from '@shm/ui/comments'
import {memo, useCallback} from 'react'
import {CommentBox, renderCommentContent} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel(props: {
  docId: UnpackedHypermediaId
  accessory: DocumentDiscussionsAccessory
  onAccessory: (acc: DocumentAccessory) => void
}) {
  const {docId, accessory} = props
  const selectedAccount = useSelectedAccount()
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
      context="accessory"
      autoFocus={accessory.autoFocus}
    />
  )

  const deleteComment = useDeleteComment()
  const deleteCommentDialog = useDeleteCommentDialog()

  const onCommentDelete = useCallback(
    (commentId: string, signingAccountId?: string) => {
      if (!signingAccountId) return
      console.log('-=- DELETE COMMENT', commentId, signingAccountId)
      deleteCommentDialog.open({
        onConfirm: () => {
          deleteComment.mutate({
            commentId,
            targetDocId: docId,
            signingAccountId,
          })
        },
      })
    },
    [docId, selectedAccount?.id?.uid],
  )

  const currentAccountId = selectedAccount?.id.uid

  if (accessory.openBlockId) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: accessory.openBlockId,
    })
    return (
      <AppDocContentProvider docId={targetId} textUnit={14} layoutUnit={16}>
        {deleteCommentDialog.content}
        <BlockDiscussions
          targetId={targetId}
          commentEditor={commentEditor}
          targetDomain={targetDomain}
          currentAccountId={currentAccountId}
          onCommentDelete={onCommentDelete}
          renderCommentContent={renderCommentContent}
        />
      </AppDocContentProvider>
    )
  }

  if (accessory.openComment) {
    return (
      <AppDocContentProvider docId={docId} textUnit={14} layoutUnit={16}>
        {deleteCommentDialog.content}
        <CommentDiscussions
          commentId={accessory.openComment}
          commentEditor={commentEditor}
          targetId={docId}
          renderCommentContent={renderCommentContent}
          targetDomain={targetDomain}
          currentAccountId={currentAccountId}
          onCommentDelete={onCommentDelete}
        />
      </AppDocContentProvider>
    )
  }

  return (
    <AppDocContentProvider docId={docId} textUnit={14} layoutUnit={16}>
      {deleteCommentDialog.content}
      <Discussions
        commentEditor={commentEditor}
        targetId={docId}
        renderCommentContent={renderCommentContent}
        targetDomain={targetDomain}
        currentAccountId={currentAccountId}
        onCommentDelete={onCommentDelete}
      />
    </AppDocContentProvider>
  )
}
