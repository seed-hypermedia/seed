---
name: Comment
summary: A signed comment on a document version, threaded through threadRoot and replyParent, with a body that is a tree of comment blocks.
---
A **comment** is a signed note on a [document version](./protocol/documents.md). It is a snapshot [blob](./blob.md): each edit publishes a whole new blob, and an empty `body` is a tombstone. The blob names its target (`space` and `path`, with `space` omitted when it equals the signer) and the document `version` the author saw. A reply carries the thread's first comment in `threadRoot` and the comment it answers in `replyParent`, which is omitted when it equals the root. `id` appears only on an edit or a tombstone and holds the [TSID](./protocol/blobs.md) of the comment being replaced. `body` is a list of [comment blocks](./block/comment.md). `account` names the stable account authority only when an authorized agent key signs for that account. `capability` is deprecated and ignored; some old blobs still carry it. <!-- id:7z70mptr -->

A comment's identity is `<authority>/<tsid>`, where `authority` is `account` when present and otherwise the signer, and the TSID of the first version is derived from the blob's bytes. Anyone can comment on anything under their own authority. A blob claiming a different `account` is indexed only when that account granted the signer an `AGENT` capability. Legacy blobs without `account` always remain signer-owned. A comment carries its own [visibility](./visibility.md). [Comments](./protocol/comments.md) covers threads, block and range comments, citations and mentions. <!-- id:mFFp2qQV -->

# See also <!-- id:87R82LEN -->

- [Comments](./protocol/comments.md): threads, block and range comments, citations and mentions. <!-- id:kbyUdjqd -->
- [block/comment](./block/comment.md): the blocks inside a comment body. <!-- id:YTU9OIkN -->
- [blob](./blob.md): the signed envelope. <!-- id:xc-eU6qV -->
- [visibility](./visibility.md): public and private comments. <!-- id:P39giTPG -->
- [Privacy](./protocol/privacy.md): who can read a private comment. <!-- id:VZu31kY1 -->
