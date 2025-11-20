import {HMComment, HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
} from '@shm/ui/comments'
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
      />
    )
  }

  if (comment) {
    return (
      <CommentDiscussions
        commentId={comment.id}
        commentEditor={commentEditor}
        targetId={props.docId}
        targetDomain={targetDomain}
      />
    )
  }

  return (
    <Discussions
      commentEditor={commentEditor}
      targetId={props.docId}
      targetDomain={targetDomain}
    />
  )
}
