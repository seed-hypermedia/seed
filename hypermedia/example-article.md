---
name: "Example: Article"
summary: "A published article: status, author, tags, a bytes body, cover image, comments, and metadata."
schemaDefinition: ipfs://bafyreigwcdu4nitdi5wsjdvpw32qrke3qbfnc3yuewqf2whszjbkmw5bgu
---
This document describes the **example-article** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:mDywKS1k -->

# Shape <!-- id:SskWA3Pk -->

A **closed struct** with these fields: <!-- id:aJ1hAcGr -->
  - `title` _(required)_ — [string](./onyx-string.md) <!-- id:BY5LvBFg -->
  - `slug` _(required)_ — [string](./onyx-string.md) <!-- id:NI1tIswC -->
  - `status` _(required)_ — [example-status](./example-status.md) <!-- id:QgfpWjHz -->
  - `author` _(required)_ — `link` → [example-person](./example-person.md) <!-- id:aQup6rX1 -->
  - `tags` — [example-tags](./example-tags.md) <!-- id:P7_H2EBV -->
  - `body` — [bytes](./onyx-bytes.md) <!-- id:MqOD-GUa -->
  - `wordCount` — [integer](./onyx-integer.md) <!-- id:yWTif4Fz -->
  - `featured` — [boolean](./onyx-boolean.md) <!-- id:qOf4Flbd -->
  - `cover` — `link` → [example-blob](./example-blob.md) <!-- id:EpmpW_6j -->
  - `comments` — list of `link` → [example-comment](./example-comment.md) <!-- id:9KW911W2 -->
  - `meta` — [example-metadata](./example-metadata.md) <!-- id:yXMv-9cW -->

# Depends on <!-- id:TN7ZVcxI -->

- [example-blob](./example-blob.md) <!-- id:zzCkTqTQ -->
- [example-comment](./example-comment.md) <!-- id:sZQYeop2 -->
- [example-metadata](./example-metadata.md) <!-- id:oVsEglmT -->
- [example-person](./example-person.md) <!-- id:t_gZrCUP -->
- [example-status](./example-status.md) <!-- id:gAEHg9q7 -->
- [example-tags](./example-tags.md) <!-- id:XZyqLYHb -->
- [boolean](./onyx-boolean.md) <!-- id:9VUmM7OM -->
- [bytes](./onyx-bytes.md) <!-- id:994wvqN5 -->
- [integer](./onyx-integer.md) <!-- id:0R3Sbn78 -->
- [string](./onyx-string.md) <!-- id:aiTuoPpm -->
