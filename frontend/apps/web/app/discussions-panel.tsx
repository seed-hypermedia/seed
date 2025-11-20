import {HMComment, HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {BlocksContent, BlocksContentProvider} from '@shm/ui/blocks-content'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
} from '@shm/ui/comments'
import {toast} from '@shm/ui/toast'
import React from 'react'

type DiscussionsPanelProps = {
  docId: UnpackedHypermediaId
  homeId: UnpackedHypermediaId
  document?: HMDocument
  originHomeId?: UnpackedHypermediaId
  siteHost?: string
  setBlockId: (blockId: string | null) => void
  comment?: HMComment
  blockId?: string
  commentEditor?: React.ReactNode
  targetDomain?: string
}

export function renderCommentContent(comment: HMComment) {
  const commentIdParts = comment.id.split('/')
  const _commentId = hmId(commentIdParts[0]!, {
    path: [commentIdParts[1]!],
  })
  return (
    <BlocksContentProvider
      key={comment.id}
      onBlockSelect={(blockId, blockRange) => {
        // todo
        toast.error('Not implemented discussions-panel onBlockSelect')
        console.log('blockId', blockId, blockRange)
      }}
      commentStyle
      textUnit={14}
      layoutUnit={16}
    >
      <BlocksContent hideCollapseButtons blocks={comment.content} />
    </BlocksContentProvider>
  )
}

export const WebDiscussionsPanel = React.memo(_WebDiscussionsPanel)

function _WebDiscussionsPanel(props: DiscussionsPanelProps) {
  const {comment, blockId, commentEditor, targetDomain, docId} = props

  if (blockId) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: blockId,
    })
    return (
      <BlockDiscussions
        targetId={targetId}
        commentEditor={commentEditor}
        targetDomain={targetDomain}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  if (comment) {
    return (
      <CommentDiscussions
        commentId={comment.id}
        commentEditor={commentEditor}
        targetId={props.docId}
        renderCommentContent={renderCommentContent}
        targetDomain={targetDomain}
      />
    )
  }

  return (
    <Discussions
      commentEditor={commentEditor}
      targetId={props.docId}
      renderCommentContent={renderCommentContent}
      targetDomain={targetDomain}
    />
  )
}
