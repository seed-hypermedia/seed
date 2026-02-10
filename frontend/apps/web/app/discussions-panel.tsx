import {
  BlockRange,
  HMComment,
  HMDocument,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {PanelContent} from '@shm/ui/accessories'
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
} from '@shm/ui/comments'
import React from 'react'
// import {useScrollRestoration} from './use-scroll-restoration'

type DiscussionsPanelProps = {
  docId: UnpackedHypermediaId
  homeId: UnpackedHypermediaId
  document?: HMDocument
  originHomeId?: UnpackedHypermediaId
  siteHost?: string
  setBlockId: (blockId: string | null) => void
  comment?: HMComment
  blockId?: string
  blockRange?: BlockRange | null
  blockRef?: string | null
  commentEditor?: React.ReactNode
  targetDomain?: string
}

export const WebDiscussionsPanel = React.memo(_WebDiscussionsPanel)

function _WebDiscussionsPanel(props: DiscussionsPanelProps) {
  const {
    comment,
    blockId,
    blockRef,
    blockRange,
    commentEditor,
    targetDomain,
    docId,
  } = props

  // TODO: Re-enable scroll restoration for web
  // const scrollRef = useScrollRestoration(`discussions-${docId.id}`)

  if (comment) {
    return (
      <PanelContent>
        <CommentDiscussions
          commentId={comment.id}
          commentEditor={commentEditor}
          targetId={props.docId}
          targetDomain={targetDomain}
          selection={
            blockRef
              ? {
                  blockId: blockRef,
                  blockRange: blockRange || undefined,
                }
              : undefined
          }
        />
      </PanelContent>
    )
  }

  if (blockId) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: blockId,
    })
    return (
      <PanelContent>
        <BlockDiscussions
          targetId={targetId}
          commentEditor={commentEditor}
          targetDomain={targetDomain}
        />
      </PanelContent>
    )
  }
  return (
    <PanelContent header={commentEditor}>
      <Discussions targetId={props.docId} targetDomain={targetDomain} />
    </PanelContent>
  )
}
