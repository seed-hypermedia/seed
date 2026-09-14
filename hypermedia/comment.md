---
name: Comment
summary: A comment on a document version, threaded via threadRoot and replyParent. Its body is a tree of comment blocks.
schemaDefinition: ipfs://bafyreigehmnqdgzc6blo7ojl3lbctzzp3wkh33or2wjmzr4e43wlqy2nga
---
This document describes the **comment** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fJpitbt3 -->

# Shape <!-- id:N7i6Swe_ -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:AWi9pItM -->
  - `type` — `"Comment"` <!-- id:gZNdkJAq -->
  - `id` — [string](./schema/string.md) <!-- id:0a38WCxb -->
  - `capability` — [cid](./cid.md) <!-- id:0BzGpgFt -->
  - `space` — [principal](./principal.md) <!-- id:d6ppVYNz -->
  - `path` — [string](./schema/string.md) <!-- id:P5ixnsgk -->
  - `version` — list of [cid](./cid.md) <!-- id:I1NS_x2j -->
  - `threadRoot` — [cid](./cid.md) <!-- id:hZXu6bZ4 -->
  - `replyParent` — [cid](./cid.md) <!-- id:uy9USgoy -->
  - `body` _(required)_ — list of [schema/block/comment](./schema/block/comment.md) <!-- id:9j2wEjJ6 -->
  - `visibility` — [visibility](./visibility.md) <!-- id:ZEob4xDQ -->

# Depends on <!-- id:R1pFNfYx -->

- [blob](./blob.md) <!-- id:3f2skHGY -->
- [cid](./cid.md) <!-- id:eWZmsC7X -->
- [schema/block/comment](./schema/block/comment.md) <!-- id:t2uHZdUL -->
- [principal](./principal.md) <!-- id:jS2x4Xbd -->
- [visibility](./visibility.md) <!-- id:rQ-v24y2 -->
- [string](./schema/string.md) <!-- id:O83cEOeS -->
