import {useSelectedAccount} from '@/selected-account'
import {useDeleteComment} from '@shm/shared/comments-service-provider'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {
  DocumentAccessory,
  DocumentDiscussionsAccessory,
} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
  useDeleteCommentDialog,
} from '@shm/ui/comments'
import {useScrollRestoration} from '@shm/ui/use-scroll-restoration'
import {memo, useCallback} from 'react'
import {CommentBox} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel(props: {
  docId: UnpackedHypermediaId
  accessory: DocumentDiscussionsAccessory
  onAccessory: (acc: DocumentAccessory) => void
}) {
  const {docId, accessory} = props
  const route = useNavRoute()
  const scrollRef = useScrollRestoration({
    scrollId: `discussions-${docId.id}`,
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })
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
      quotingBlockId={accessory.targetBlockId}
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

  if (accessory.targetBlockId) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: accessory.targetBlockId,
    })
    return (
      <>
        {deleteCommentDialog.content}
        <BlockDiscussions
          targetId={targetId}
          commentEditor={commentEditor}
          targetDomain={targetDomain}
          currentAccountId={currentAccountId}
          onCommentDelete={onCommentDelete}
          scrollRef={scrollRef}
        />
      </>
    )
  }

  if (accessory.openComment) {
    return (
      <>
        {deleteCommentDialog.content}
        <CommentDiscussions
          commentId={accessory.openComment}
          commentEditor={commentEditor}
          targetId={docId}
          targetDomain={targetDomain}
          currentAccountId={currentAccountId}
          onCommentDelete={onCommentDelete}
          scrollRef={scrollRef}
          selection={
            accessory.blockId
              ? {
                  blockId: accessory.blockId,
                  blockRange: accessory.blockRange || undefined,
                }
              : undefined
          }
        />
      </>
    )
  }

  return (
    <>
      {deleteCommentDialog.content}
      <Discussions
        commentEditor={commentEditor}
        targetId={docId}
        targetDomain={targetDomain}
        currentAccountId={currentAccountId}
        onCommentDelete={onCommentDelete}
        scrollRef={scrollRef}
      />
    </>
  )
}
