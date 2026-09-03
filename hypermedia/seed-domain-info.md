---
name: Domain info
summary: "The daemon's view of a site domain: registration, gateway status, and health-check results. A derived read model computed by the Seed daemon/API for clients — n"
schemaDefinition: ipfs://bafyreictuqqfmw6ysmwd67hwnzivv2jl2jdaw3ffmu7jsjsz36nnwrqayq
---
The daemon's view of a site domain: registration, gateway status, and health-check results. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:0-pCYFt2 -->

This document describes the **seed-domain-info** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:DI-UIA2D -->

# Shape <!-- id:ekpw-cCp -->

A **closed struct** with these fields: <!-- id:xuUlh0JO -->
  - `domain` _(required)_ — [string](./onyx-string.md) <!-- id:0oRkcHc4 -->
  - `lastCheck` _(required)_ — one of [string](./onyx-string.md) | [null](./onyx-null.md) <!-- id:op-PJX0_ -->
  - `status` _(required)_ — [string](./onyx-string.md) <!-- id:-nDqsTzH -->
  - `lastSuccess` _(required)_ — one of [string](./onyx-string.md) | [null](./onyx-null.md) <!-- id:02R65FHg -->
  - `registeredAccountUid` _(required)_ — one of [string](./onyx-string.md) | [null](./onyx-null.md) <!-- id:te87btfE -->
  - `peerId` _(required)_ — one of [string](./onyx-string.md) | [null](./onyx-null.md) <!-- id:PLQslevr -->
  - `isGateway` _(required)_ — [boolean](./onyx-boolean.md) <!-- id:e9kFFZZK -->
  - `lastError` _(required)_ — one of [string](./onyx-string.md) | [null](./onyx-null.md) <!-- id:KicuZnnK -->

# Depends on <!-- id:IX_BCuo3 -->

- [boolean](./onyx-boolean.md) <!-- id:DyUUe03G -->
- [null](./onyx-null.md) <!-- id:QzHgJRnw -->
- [string](./onyx-string.md) <!-- id:UW_sdNOt -->
