---
name: Domain Info
summary: "The daemon’s view of a site domain: registration, gateway status, and health-check results."
schemaDefinition: ipfs://bafyreidbfhbfgvkr4rfoys5pclifv3lpgziqnlefrxqdufcrrnyso74gyu
---
The daemon's view of a site domain: registration, gateway status, and health-check results. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:0-pCYFt2 -->

This page describes the **rpc/type/domain-info** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:DI-UIA2D -->

# Shape <!-- id:ekpw-cCp -->

A **closed struct** with these fields: <!-- id:xuUlh0JO -->
  - `domain` _(required)_: [string](../../string.md) <!-- id:0oRkcHc4 -->
  - `lastCheck` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:op-PJX0_ -->
  - `status` _(required)_: [string](../../string.md) <!-- id:-nDqsTzH -->
  - `lastSuccess` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:02R65FHg -->
  - `registeredAccountUid` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:te87btfE -->
  - `peerId` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:PLQslevr -->
  - `isGateway` _(required)_: [boolean](../../boolean.md) <!-- id:e9kFFZZK -->
  - `lastError` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:KicuZnnK -->

# Depends on <!-- id:IX_BCuo3 -->

- [boolean](../../boolean.md) <!-- id:DyUUe03G -->
- [null](../../null.md) <!-- id:QzHgJRnw -->
- [string](../../string.md) <!-- id:UW_sdNOt -->
