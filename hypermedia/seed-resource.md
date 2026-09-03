---
name: Resource
summary: "The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by "
schemaDefinition: ipfs://bafyreicdh6ygouxie6xlnfdikbtd6xz465aem3fz7h3oh54cw2t4yyopf4
---
The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:DKrlmk-b -->

This document describes the **seed-resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:8qMDyX3F -->

# Shape <!-- id:QnWTk-_C -->

A **union** — a value matches one of these variants: <!-- id:jNUpA86w -->
  - [seed-resource-document](./seed-resource-document.md) <!-- id:_NMQg8CE -->
  - [seed-resource-comment](./seed-resource-comment.md) <!-- id:7TyvB5RT -->
  - [seed-resource-redirect](./seed-resource-redirect.md) <!-- id:Qk2kHMNK -->
  - [seed-resource-not-found](./seed-resource-not-found.md) <!-- id:puViM4jF -->
  - [seed-resource-tombstone](./seed-resource-tombstone.md) <!-- id:4g2ZdiEu -->
  - [seed-resource-error](./seed-resource-error.md) <!-- id:zAIVwKIe -->

# Depends on <!-- id:N8NdNOBK -->

- [seed-resource-comment](./seed-resource-comment.md) <!-- id:H4xXgtvX -->
- [seed-resource-document](./seed-resource-document.md) <!-- id:TXHngH-I -->
- [seed-resource-error](./seed-resource-error.md) <!-- id:UEIBXH0y -->
- [seed-resource-not-found](./seed-resource-not-found.md) <!-- id:fm6kS7fS -->
- [seed-resource-redirect](./seed-resource-redirect.md) <!-- id:g4RUXR0d -->
- [seed-resource-tombstone](./seed-resource-tombstone.md) <!-- id:30MZAJAa -->
