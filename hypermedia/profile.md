---
name: Profile
summary: "A snapshot describing an account: display name, avatar, and description — or an alias redirecting to another key."
schemaDefinition: ipfs://bafyreich65btvsm2ibqgtjkd7ydk444wd56bi5qz2nrjvpwmlofplql2p4
---
This document describes the **profile** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:cZeSgsmH -->

# Shape <!-- id:_CVm1QUz -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:1UgKs7D_ -->
  - `type` — `"Profile"` <!-- id:N3u2-MXs -->
  - `alias` — [principal](./principal.md) <!-- id:4GNS3Kp_ -->
  - `name` — [string](./string.md) <!-- id:3XSac4Ad -->
  - `avatar` — [string](./string.md) <!-- id:3R4vEqDy -->
  - `description` — [string](./string.md) <!-- id:ITRFxA9m -->
  - `account` — [principal](./principal.md) <!-- id:6nYH0t9c -->

# Depends on <!-- id:yqwCrza_ -->

- [blob](./blob.md) <!-- id:5nAT-Ca0 -->
- [principal](./principal.md) <!-- id:XELjiLjq -->
- [string](./string.md) <!-- id:U1O1ayoB -->
