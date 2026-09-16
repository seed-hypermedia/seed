---
name: Resource
summary: "The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by "
schemaDefinition: ipfs://bafyreifrbbw4hsotmyhhozjgy5ujnn33izocem7irfayjryihnyaoqaxui
---
The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:DKrlmk-b -->

This document describes the **rpc/type/resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:8qMDyX3F -->

# Shape <!-- id:QnWTk-_C -->

A **union** — a value matches one of these variants: <!-- id:jNUpA86w -->
  - [rpc/type/resource-document](./resource-document.md) <!-- id:_NMQg8CE -->
  - [rpc/type/resource-comment](./resource-comment.md) <!-- id:7TyvB5RT -->
  - [rpc/type/resource-redirect](./resource-redirect.md) <!-- id:Qk2kHMNK -->
  - [rpc/type/resource-not-found](./resource-not-found.md) <!-- id:puViM4jF -->
  - [rpc/type/resource-tombstone](./resource-tombstone.md) <!-- id:4g2ZdiEu -->
  - [rpc/type/resource-error](./resource-error.md) <!-- id:zAIVwKIe -->

# Depends on <!-- id:N8NdNOBK -->

- [rpc/type/resource-comment](./resource-comment.md) <!-- id:H4xXgtvX -->
- [rpc/type/resource-document](./resource-document.md) <!-- id:TXHngH-I -->
- [rpc/type/resource-error](./resource-error.md) <!-- id:UEIBXH0y -->
- [rpc/type/resource-not-found](./resource-not-found.md) <!-- id:fm6kS7fS -->
- [rpc/type/resource-redirect](./resource-redirect.md) <!-- id:g4RUXR0d -->
- [rpc/type/resource-tombstone](./resource-tombstone.md) <!-- id:30MZAJAa -->
