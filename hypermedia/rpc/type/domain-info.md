---
name: Domain Info
summary: "The daemon’s view of a site domain: registration, gateway status, and health-check results."
schemaDefinition: ipfs://bafyreidbfhbfgvkr4rfoys5pclifv3lpgziqnlefrxqdufcrrnyso74gyu
---
The daemon's view of a [site](../../protocol/sites.md) domain: registration, gateway status and health-check results. <!-- id:0-pCYFt2 -->

This page describes the **rpc/type/domain-info** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:DI-UIA2D -->

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

# See also <!-- id:tYzXGxPs -->

- [GetDomain](../get-domain.md): check one domain. <!-- id:HeRRjVoH -->
- [ListDomains](../list-domains.md): every known domain. <!-- id:OkEavDJa -->
- [Sites](../../protocol/sites.md): domains and gateways. <!-- id:CDlbtVTg -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:MRTbXZmC -->
