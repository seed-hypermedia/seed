---
name: Comment
summary: A signed comment on a document version, threaded through threadRoot and replyParent, with a body that is a tree of comment blocks.
---
A **comment** is a signed note on one version of a [document](./protocol/documents.md). [Comments](./protocol/comments.md) explains how threads and replies work. A comment is a snapshot [blob](./protocol/blobs.md): each edit publishes a whole new blob. A blob with an empty `body` is a tombstone, which deletes the comment. <!-- id:7z70mptr -->

# Fields

A comment has these fields. The first row is the signed [blob](./blob.md) envelope, which every blob carries.

<!-- id:lZeNI6EG -->
| key <!-- col:fYfV8Z9P --> | meaning <!-- col:OBQZ_Koi --> <!-- id:yLoNYlB6 --> |
| --- | --- |
| `signer`, `ts`, `sig` | the envelope every blob carries: which key signed it and when <!-- id:3AvWahqt --> |
| `account` | the [account](./protocol/identity.md) an authorized [agent](./agent.md) key signs for; omitted when the signer writes for itself |
| `space`, `path` | the document it targets; `space` is omitted when it equals the signer <!-- id:kYYrayoz --> |
| `version` | the [CIDs](./cid.md) of the document heads the author was looking at; required, since a comment without a version names no document <!-- id:X2-9MteI --> |
| `threadRoot` | the CID of the first comment of the thread; present on every reply <!-- id:nUJmFMVQ --> |
| `replyParent` | the CID of the comment this one replies to; omitted when it equals `threadRoot` <!-- id:VnwV6eo_ --> |
| `body` | a list of [comment blocks](./block/comment.md): a [block](./protocol/blocks.md) plus its children, to any depth <!-- id:f8Cqg5IZ --> |
| `id` | present only on an edit or a deletion: the [TSID](./protocol/blobs.md) of the comment being replaced <!-- id:gO4Blmy5 --> |
| `visibility` | `""` for public, `Private` for private <!-- id:ISOBhZJR --> |
| `capability` | deprecated and ignored; old blobs may carry it <!-- id:eJ16dkIA --> |

A comment's identity is `<authority>/<tsid>`. The authority is `account` when present, and the signer otherwise. The TSID of the first version is derived from the blob's bytes. Anyone can comment on anything under their own authority. A blob that claims a different `account` is indexed only when that account granted the signer an `AGENT` [capability](./protocol/permissions.md). Older blobs without `account` always belong to the signer. A comment carries its own [visibility](./visibility.md). [Comments](./protocol/comments.md) covers threads, comments on a block or a text range, citations and mentions. <!-- id:mFFp2qQV -->

# See also <!-- id:87R82LEN -->

- [Comments](./protocol/comments.md): threads, block and range comments, citations and mentions. <!-- id:kbyUdjqd -->
- [block/comment](./block/comment.md): the blocks inside a comment body. <!-- id:YTU9OIkN -->
- [blob](./blob.md): the signed envelope. <!-- id:xc-eU6qV -->
- [visibility](./visibility.md): public and private comments. <!-- id:P39giTPG -->
- [Privacy](./protocol/privacy.md): who can read a private comment. <!-- id:VZu31kY1 -->
