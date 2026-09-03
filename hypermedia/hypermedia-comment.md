---
name: Comment
summary: A comment on a document version, threaded via threadRoot and replyParent. Its body is a tree of comment blocks.
schemaDefinition: ipfs://bafyreiddlauzh4qjsx6g4vc5wxiklzxrixomo3unbtkhb2oodhpmkgpjmq
---
This document describes the **hypermedia-comment** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fJpitbt3 -->

# Shape <!-- id:N7i6Swe_ -->

**Extends** [hypermedia-blob](./hypermedia-blob.md) with these added fields: <!-- id:AWi9pItM -->
  - `type` — `string` enum: `Comment` <!-- id:gZNdkJAq -->
  - `id` — [string](./onyx-string.md) <!-- id:0a38WCxb -->
  - `capability` — [hypermedia-cid](./hypermedia-cid.md) <!-- id:0BzGpgFt -->
  - `space` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:d6ppVYNz -->
  - `path` — [string](./onyx-string.md) <!-- id:P5ixnsgk -->
  - `version` — list of [hypermedia-cid](./hypermedia-cid.md) <!-- id:I1NS_x2j -->
  - `threadRoot` — [hypermedia-cid](./hypermedia-cid.md) <!-- id:hZXu6bZ4 -->
  - `replyParent` — [hypermedia-cid](./hypermedia-cid.md) <!-- id:uy9USgoy -->
  - `body` _(required)_ — list of [hypermedia-comment-block](./hypermedia-comment-block.md) <!-- id:9j2wEjJ6 -->
  - `visibility` — [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:ZEob4xDQ -->

# Depends on <!-- id:R1pFNfYx -->

- [hypermedia-blob](./hypermedia-blob.md) <!-- id:3f2skHGY -->
- [hypermedia-cid](./hypermedia-cid.md) <!-- id:eWZmsC7X -->
- [hypermedia-comment-block](./hypermedia-comment-block.md) <!-- id:t2uHZdUL -->
- [hypermedia-principal](./hypermedia-principal.md) <!-- id:jS2x4Xbd -->
- [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:rQ-v24y2 -->
- [string](./onyx-string.md) <!-- id:O83cEOeS -->
