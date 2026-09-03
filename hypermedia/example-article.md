---
name: "Example: Article"
summary: "A published article: status, author, tags, a bytes body, cover image, comments, and metadata."
schemaDefinition: ipfs://bafyreihgytyb2x3uqnsvpmiyw3xo7pulc2re4qdqtqoyk2u3og3l7sz2sy
---
This document describes the **example-article** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:mDywKS1k -->

# Shape <!-- id:SskWA3Pk -->

A **closed struct** with these fields: <!-- id:aJ1hAcGr -->
  - `title` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:BY5LvBFg -->
  - `slug` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:NI1tIswC -->
  - `status` _(required)_ — [example-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-status) <!-- id:QgfpWjHz -->
  - `author` _(required)_ — `link` → [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person) <!-- id:aQup6rX1 -->
  - `tags` — [example-tags](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-tags) <!-- id:P7_H2EBV -->
  - `body` — [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:MqOD-GUa -->
  - `wordCount` — [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:yWTif4Fz -->
  - `featured` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:qOf4Flbd -->
  - `cover` — `link` → [example-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-blob) <!-- id:EpmpW_6j -->
  - `comments` — list of `link` → [example-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-comment) <!-- id:9KW911W2 -->
  - `meta` — [example-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-metadata) <!-- id:yXMv-9cW -->

# Depends on <!-- id:TN7ZVcxI -->

- [example-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-blob) <!-- id:zzCkTqTQ -->
- [example-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-comment) <!-- id:sZQYeop2 -->
- [example-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-metadata) <!-- id:oVsEglmT -->
- [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person) <!-- id:t_gZrCUP -->
- [example-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-status) <!-- id:gAEHg9q7 -->
- [example-tags](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-tags) <!-- id:XZyqLYHb -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:9VUmM7OM -->
- [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:994wvqN5 -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:0R3Sbn78 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:aiTuoPpm -->
