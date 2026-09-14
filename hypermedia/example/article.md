---
name: "Example: Article"
summary: "A published article: status, author, tags, a bytes body, cover image, comments, and metadata."
schemaDefinition: ipfs://bafyreie4xfprehtxcz7w3rbavzsrgdvapsdhu6lva7v6k3m4lcn2yyqnsi
---
This document describes the **example/article** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:mDywKS1k -->

# Shape <!-- id:SskWA3Pk -->

A **closed struct** with these fields: <!-- id:aJ1hAcGr -->
  - `title` _(required)_ — [string](../string.md) <!-- id:BY5LvBFg -->
  - `slug` _(required)_ — [string](../string.md) <!-- id:NI1tIswC -->
  - `status` _(required)_ — [example/status](./status.md) <!-- id:QgfpWjHz -->
  - `author` _(required)_ — `link` → [example/person](./person.md) <!-- id:aQup6rX1 -->
  - `tags` — [example/tags](./tags.md) <!-- id:P7_H2EBV -->
  - `body` — [bytes](../bytes.md) <!-- id:MqOD-GUa -->
  - `wordCount` — [integer](../integer.md) <!-- id:yWTif4Fz -->
  - `featured` — [boolean](../boolean.md) <!-- id:qOf4Flbd -->
  - `cover` — `link` → [example/blob](./blob.md) <!-- id:EpmpW_6j -->
  - `comments` — list of `link` → [example/comment](./comment.md) <!-- id:9KW911W2 -->
  - `meta` — [example/metadata](./metadata.md) <!-- id:yXMv-9cW -->

# Depends on <!-- id:TN7ZVcxI -->

- [example/blob](./blob.md) <!-- id:zzCkTqTQ -->
- [example/comment](./comment.md) <!-- id:sZQYeop2 -->
- [example/metadata](./metadata.md) <!-- id:oVsEglmT -->
- [example/person](./person.md) <!-- id:t_gZrCUP -->
- [example/status](./status.md) <!-- id:gAEHg9q7 -->
- [example/tags](./tags.md) <!-- id:XZyqLYHb -->
- [boolean](../boolean.md) <!-- id:9VUmM7OM -->
- [bytes](../bytes.md) <!-- id:994wvqN5 -->
- [integer](../integer.md) <!-- id:0R3Sbn78 -->
- [string](../string.md) <!-- id:aiTuoPpm -->
