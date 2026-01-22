import {useSelectedAccount} from '@/selected-account'
import {useDeleteComment} from '@shm/shared/comments-service-provider'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {DiscussionsRoute} from '@shm/shared/routes'
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
  selection: DiscussionsRoute
}) {
  const {docId, selection} = props
  // Use selection.id if available (panel's own target), otherwise fall back to docId
  const targetDocId = selection.id ?? docId
  const route = useNavRoute()
  const scrollRef = useScrollRestoration({
    scrollId: `discussions-${targetDocId.id}`,
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })
  const selectedAccount = useSelectedAccount()
  const homeDoc = useResource(hmId(targetDocId.uid))
  const targetDomain =
    homeDoc.data?.type === 'document'
      ? homeDoc.data.document.metadata.siteUrl
      : undefined

  const commentEditor = (
    <CommentBox
      docId={targetDocId}
      commentId={selection.openComment}
      quotingBlockId={selection.targetBlockId}
      context="accessory"
      autoFocus={selection.autoFocus}
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
            targetDocId,
            signingAccountId,
          })
        },
      })
    },
    [targetDocId, selectedAccount?.id?.uid],
  )

  const currentAccountId = selectedAccount?.id.uid

  if (selection.targetBlockId) {
    const targetId = hmId(targetDocId.uid, {
      ...targetDocId,
      blockRef: selection.targetBlockId,
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

  if (selection.openComment) {
    // Block selection comes from selection.id.blockRef (the focused block within the comment)
    const blockId = selection.id?.blockRef
    const blockRange = selection.id?.blockRange
    return (
      <>
        {deleteCommentDialog.content}
        <CommentDiscussions
          commentId={selection.openComment}
          commentEditor={commentEditor}
          targetId={targetDocId}
          targetDomain={targetDomain}
          currentAccountId={currentAccountId}
          onCommentDelete={onCommentDelete}
          scrollRef={scrollRef}
          selection={
            blockId
              ? {
                  blockId,
                  blockRange: blockRange || undefined,
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
        targetId={targetDocId}
        targetDomain={targetDomain}
        currentAccountId={currentAccountId}
        onCommentDelete={onCommentDelete}
        scrollRef={scrollRef}
      />
    </>
  )
}
