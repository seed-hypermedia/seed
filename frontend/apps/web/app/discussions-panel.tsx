import {HMComment, HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
} from '@shm/ui/comments'
import {BlocksContent} from '@shm/ui/document-content'
import React, {useCallback} from 'react'

import {WebDocContentProvider} from './doc-content-provider'

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
          <WebDocContentProvider
            key={comment.id}
            originHomeId={homeId}
            siteHost={siteHost}
            comment
            textUnit={14}
            layoutUnit={16}
          >
            <BlocksContent
              hideCollapseButtons
              blocks={comment.content}
              parentBlockId={null}
            />
          </WebDocContentProvider>
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
      <WebDocContentProvider
        originHomeId={homeId}
        siteHost={siteHost}
        textUnit={14}
        layoutUnit={16}
      >
        <BlockDiscussions
          targetId={targetId}
          commentEditor={commentEditor}
          targetDomain={targetDomain}
          renderCommentContent={renderCommentContent}
        />
      </WebDocContentProvider>
    )
  }

  if (comment) {
    return (
      <WebDocContentProvider
        originHomeId={homeId}
        siteHost={siteHost}
        textUnit={14}
      >
        <CommentDiscussions
          commentId={comment.id}
          commentEditor={commentEditor}
          targetId={props.docId}
          renderCommentContent={renderCommentContent}
          targetDomain={targetDomain}
        />
      </WebDocContentProvider>
    )
  }

  return (
    <WebDocContentProvider
      originHomeId={homeId}
      siteHost={siteHost}
      textUnit={14}
    >
      <Discussions
        commentEditor={commentEditor}
        targetId={props.docId}
        renderCommentContent={renderCommentContent}
        targetDomain={targetDomain}
      />
    </WebDocContentProvider>
  )
}
