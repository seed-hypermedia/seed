---
name: Comment
summary: A signed comment on a document version, threaded through threadRoot and replyParent, with a body that is a tree of comment blocks.
---
A **comment** is a signed note on a [document version](./protocol/documents.md). It is a snapshot [blob](./blob.md): each edit publishes a whole new blob, and an empty `body` is a tombstone. <!-- id:7z70mptr -->

# Fields

A comment adds these fields to the signed [blob](./blob.md) envelope:

<!-- id:lZeNI6EG -->
| key <!-- col:fYfV8Z9P --> | meaning <!-- col:OBQZ_Koi --> <!-- id:yLoNYlB6 --> |
| --- | --- |
| `signer`, `ts`, `sig` | the envelope every blob carries: who wrote it and when <!-- id:3AvWahqt --> |
| `space`, `path` | the document it targets; `space` is omitted when it equals the signer <!-- id:kYYrayoz --> |
| `version` | the CIDs of the document heads the author was looking at; empty means "the document at this path" <!-- id:X2-9MteI --> |
| `threadRoot` | the CID of the first comment of the thread; present on every reply <!-- id:nUJmFMVQ --> |
| `replyParent` | the CID of the comment this one replies to; omitted when it equals `threadRoot` <!-- id:VnwV6eo_ --> |
| `body` | a list of [comment blocks](./block/comment.md): a block plus its children, recursively <!-- id:f8Cqg5IZ --> |
| `id` | present only on an edit or a deletion: the TSID of the comment being replaced <!-- id:gO4Blmy5 --> |
| `visibility` | `""` for public, `Private` for private <!-- id:ISOBhZJR --> |
| `capability` | deprecated and ignored; old blobs may carry it <!-- id:eJ16dkIA --> |

A comment's identity is `<author>/<tsid>`, where the TSID of the first version is derived from the blob's bytes. Comments are not permission-checked: anyone can comment on anything. A comment carries its own [visibility](./visibility.md). [Comments](./protocol/comments.md) covers threads, block and range comments, citations and mentions. <!-- id:mFFp2qQV -->

# See also <!-- id:87R82LEN -->

- [Comments](./protocol/comments.md): threads, block and range comments, citations and mentions. <!-- id:kbyUdjqd -->
- [block/comment](./block/comment.md): the blocks inside a comment body. <!-- id:YTU9OIkN -->
- [blob](./blob.md): the signed envelope. <!-- id:xc-eU6qV -->
- [visibility](./visibility.md): public and private comments. <!-- id:P39giTPG -->
- [Privacy](./protocol/privacy.md): who can read a private comment. <!-- id:VZu31kY1 -->
