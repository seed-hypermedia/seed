---
name: Comment
summary: A comment on a document version, threaded via threadRoot and replyParent. Its body is a tree of comment blocks.
schemaDefinition: ipfs://bafyreihybso5euasrkergawv3jpbvzau3ctgu4bkt4dyfh6y3l5kybb6f4
---
This document describes the **hypermedia-comment** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fJpitbt3 -->

# Shape <!-- id:N7i6Swe_ -->
**Extends** [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) with these added fields: <!-- id:AWi9pItM -->
  - `type` — `string` enum: `Comment` <!-- id:gZNdkJAq -->
  - `id` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:0a38WCxb -->
  - `capability` — [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:0BzGpgFt -->
  - `space` — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:d6ppVYNz -->
  - `path` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:P5ixnsgk -->
  - `version` — list of [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:I1NS_x2j -->
  - `threadRoot` — [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:hZXu6bZ4 -->
  - `replyParent` — [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:uy9USgoy -->
  - `body` _(required)_ — list of [hypermedia-comment-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-comment-block) <!-- id:9j2wEjJ6 -->
  - `visibility` — [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:ZEob4xDQ -->

# Depends on <!-- id:R1pFNfYx -->
- [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) <!-- id:3f2skHGY -->
- [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:eWZmsC7X -->
- [hypermedia-comment-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-comment-block) <!-- id:t2uHZdUL -->
- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:jS2x4Xbd -->
- [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:rQ-v24y2 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:O83cEOeS -->