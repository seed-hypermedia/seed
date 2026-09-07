---
name: Redirect target
summary: A redirect from one document to another space and/or path.
schemaDefinition: ipfs://bafyreihrkicalhriaszf2akixg6l2jcnrmf62ypa6f3iyj2hvimlhu2ft4
---
This document describes the **hypermedia-redirect-target** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:BDVJInYn -->

# Shape <!-- id:Mw7vaa0_ -->

A **closed struct** with these fields: <!-- id:vOHPKMNt -->
  - `space` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:BX1XxAo1 -->
  - `path` — [string](./hypermedia-string.md) <!-- id:tkiZCNDO -->
  - `republish` — [boolean](./hypermedia-boolean.md) <!-- id:f8ILSJ4c -->

# Depends on <!-- id:n0grsHmb -->

- [hypermedia-principal](./hypermedia-principal.md) <!-- id:dMEzYQIO -->
- [boolean](./hypermedia-boolean.md) <!-- id:zkw60tb9 -->
- [string](./hypermedia-string.md) <!-- id:jyHqppJd -->
