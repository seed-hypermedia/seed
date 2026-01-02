import {
  BlockRange,
  HMComment,
  HMDocument,
  UnpackedHypermediaId,
} from "@shm/shared/hm-types";
import { hmId } from "@shm/shared/utils/entity-id-url";
import {
  BlockDiscussions,
  CommentDiscussions,
  Discussions,
} from "@shm/ui/comments";
import React from "react";
// import {useScrollRestoration} from './use-scroll-restoration'

type DiscussionsPanelProps = {
  docId: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  document?: HMDocument;
  originHomeId?: UnpackedHypermediaId;
  siteHost?: string;
  setBlockId: (blockId: string | null) => void;
  comment?: HMComment;
  blockId?: string;
  blockRange?: BlockRange | null;
  blockRef?: string | null;
  commentEditor?: React.ReactNode;
  targetDomain?: string;
};

export const WebDiscussionsPanel = React.memo(_WebDiscussionsPanel);

function _WebDiscussionsPanel(props: DiscussionsPanelProps) {
  const {
    comment,
    blockId,
    blockRef,
    blockRange,
    commentEditor,
    targetDomain,
    docId,
  } = props;

  // TODO: Re-enable scroll restoration for web
  // const scrollRef = useScrollRestoration(`discussions-${docId.id}`)

  if (comment) {
    return (
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
    );
  }

  if (blockId) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: blockId,
    });
    return (
      <BlockDiscussions
        targetId={targetId}
        commentEditor={commentEditor}
        targetDomain={targetDomain}
      />
    );
  }
  return (
    <Discussions
      commentEditor={commentEditor}
      targetId={props.docId}
      targetDomain={targetDomain}
    />
  );
}
