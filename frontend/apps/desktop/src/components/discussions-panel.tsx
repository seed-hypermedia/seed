import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {CommentsRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {PanelContent} from '@shm/ui/accessories'
import {BlockDiscussions, CommentDiscussions, Discussions} from '@shm/ui/comments'
import {memo} from 'react'
import {CommentBox} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel(props: {docId: UnpackedHypermediaId; selection: CommentsRoute}) {
  const {docId, selection} = props
  // Use selection.id if available (panel's own target), otherwise fall back to docId
  const targetDocId = selection.id ?? docId
  const homeDoc = useResource(hmId(targetDocId.uid))
  const targetDomain = homeDoc.data?.type === 'document' ? homeDoc.data.document.metadata.siteUrl : undefined

  const commentEditor = (
    <CommentBox
      docId={targetDocId}
      commentId={selection.openComment}
      quotingBlockId={selection.targetBlockId}
      context="accessory"
      autoFocus={selection.autoFocus}
    />
  )

  if (selection.targetBlockId) {
    const targetId = hmId(targetDocId.uid, {
      ...targetDocId,
      blockRef: selection.targetBlockId,
    })
    return (
      <PanelContent>
        <BlockDiscussions targetId={targetId} commentEditor={commentEditor} targetDomain={targetDomain} />
      </PanelContent>
    )
  }

  if (selection.openComment) {
    // Block selection comes from selection.id.blockRef (the focused block within the comment)
    const blockId = selection.id?.blockRef
    const blockRange = selection.id?.blockRange
    return (
      <PanelContent>
        <CommentDiscussions
          commentId={selection.openComment}
          commentEditor={commentEditor}
          targetId={targetDocId}
          targetDomain={targetDomain}
          isEntirelyHighlighted={!blockId}
          selection={
            blockId
              ? {
                  blockId,
                  blockRange: blockRange || undefined,
                }
              : undefined
          }
        />
      </PanelContent>
    )
  }

  return (
    <PanelContent header={commentEditor}>
      <Discussions targetId={targetDocId} targetDomain={targetDomain} />
    </PanelContent>
  )
}
