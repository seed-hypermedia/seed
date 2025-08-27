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
  enableWebSigning: boolean
  comment?: HMComment
  blockId?: string
  handleBack: () => void
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
    handleBack,
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
      <WebDocContentProvider originHomeId={homeId} siteHost={siteHost}>
        <BlockDiscussions
          targetId={targetId}
          commentEditor={commentEditor}
          onBack={handleBack}
          targetDomain={targetDomain}
          renderCommentContent={renderCommentContent}
        />
      </WebDocContentProvider>
    )
  }

  if (comment) {
    return (
      <CommentDiscussions
        onBack={handleBack}
        commentId={comment.id}
        commentEditor={commentEditor}
        targetId={props.docId}
        renderCommentContent={renderCommentContent}
        targetDomain={targetDomain}
      />
    )
  }

  return (
    <>
      <Discussions
        commentEditor={commentEditor}
        targetId={props.docId}
        renderCommentContent={renderCommentContent}
        targetDomain={targetDomain}
      />
    </>
  )
}
