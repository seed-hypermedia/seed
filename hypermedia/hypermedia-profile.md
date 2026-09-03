---
name: Profile
summary: "A snapshot describing an account: display name, avatar, and description — or an alias redirecting to another key."
schemaDefinition: ipfs://bafyreig4ujqutkupwplzzhnm3syeeru5w2qz3ylj66ag4qn233hqsg5oqa
---
This document describes the **hypermedia-profile** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:cZeSgsmH -->

# Shape <!-- id:_CVm1QUz -->

**Extends** [hypermedia-blob](./hypermedia-blob.md) with these added fields: <!-- id:1UgKs7D_ -->
  - `type` — `string` enum: `Profile` <!-- id:N3u2-MXs -->
  - `alias` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:4GNS3Kp_ -->
  - `name` — [string](./onyx-string.md) <!-- id:3XSac4Ad -->
  - `avatar` — [string](./onyx-string.md) <!-- id:3R4vEqDy -->
  - `description` — [string](./onyx-string.md) <!-- id:ITRFxA9m -->
  - `account` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:6nYH0t9c -->

# Depends on <!-- id:yqwCrza_ -->

- [hypermedia-blob](./hypermedia-blob.md) <!-- id:5nAT-Ca0 -->
- [hypermedia-principal](./hypermedia-principal.md) <!-- id:XELjiLjq -->
- [string](./onyx-string.md) <!-- id:U1O1ayoB -->
