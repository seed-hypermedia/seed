---
name: Comment
summary: "A signed comment on a document version, threaded through threadRoot and replyParent, with a body that is a tree of comment blocks."
schemaDefinition: ipfs://bafyreih2ik7yfwmwklamuzz5mg6wcdejxffdhflf6jagvia2ia562dmqpi
---
A **comment** is a signed note on a [document version](./protocol/documents.md). It is a snapshot [blob](./blob.md): each edit publishes a whole new blob, and an empty `body` is a tombstone. The blob names its target (`space` and `path`, with `space` omitted when it equals the signer) and the document `version` the author saw. A reply carries the thread's first comment in `threadRoot` and the comment it answers in `replyParent`, which is omitted when it equals the root. `id` appears only on an edit or a tombstone and holds the [TSID](./protocol/blobs.md) of the comment being replaced. `body` is a list of [comment blocks](./block/comment.md). `capability` is deprecated and ignored; some old blobs still carry it.

A comment's identity is `<author>/<tsid>`, where the TSID of the first version is derived from the blob's bytes. Comments are not permission-checked: anyone can comment on anything. A comment carries its own [visibility](./visibility.md). [Comments](./protocol/comments.md) covers threads, block and range comments, citations and mentions.

# Shape <!-- id:N7i6Swe_ -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:AWi9pItM -->
  - `type`: `"Comment"` <!-- id:gZNdkJAq -->
  - `id`: [string](./string.md) <!-- id:0a38WCxb -->
  - `capability`: [cid](./cid.md) <!-- id:0BzGpgFt -->
  - `space`: [principal](./principal.md) <!-- id:d6ppVYNz -->
  - `path`: [string](./string.md) <!-- id:P5ixnsgk -->
  - `version`: list of [cid](./cid.md) <!-- id:I1NS_x2j -->
  - `threadRoot`: [cid](./cid.md) <!-- id:hZXu6bZ4 -->
  - `replyParent`: [cid](./cid.md) <!-- id:uy9USgoy -->
  - `body` _(required)_: list of [block/comment](./block/comment.md) <!-- id:9j2wEjJ6 -->
  - `visibility`: [visibility](./visibility.md) <!-- id:ZEob4xDQ -->

# Depends on <!-- id:R1pFNfYx -->

- [blob](./blob.md) <!-- id:3f2skHGY -->
- [cid](./cid.md) <!-- id:eWZmsC7X -->
- [block/comment](./block/comment.md) <!-- id:t2uHZdUL -->
- [principal](./principal.md) <!-- id:jS2x4Xbd -->
- [visibility](./visibility.md) <!-- id:rQ-v24y2 -->
- [string](./string.md) <!-- id:O83cEOeS -->

# See also

- [Comments](./protocol/comments.md): threads, block and range comments, citations and mentions.
- [block/comment](./block/comment.md): the blocks inside a comment body.
- [blob](./blob.md): the signed envelope.
- [visibility](./visibility.md): public and private comments.
- [Privacy](./protocol/privacy.md): who can read a private comment.
