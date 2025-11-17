import {HMComment, HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {BlocksContent} from '@shm/ui/blocks-content'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
} from '@shm/ui/comments'
import React, {useCallback} from 'react'

import {WebBlocksContentProvider} from './blocks-content-provider'

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
  const {
    homeId,
    comment,
    blockId,
    commentEditor,
    siteHost,
    targetDomain,
    docId,
  } = props
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        homeId && (
          <WebBlocksContentProvider
            key={comment.id}
            originHomeId={homeId}
            siteHost={siteHost}
            commentStyle
            textUnit={14}
            layoutUnit={16}
          >
            <BlocksContent hideCollapseButtons blocks={comment.content} />
          </WebBlocksContentProvider>
        )
      )
    },
    [homeId],
  )

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
