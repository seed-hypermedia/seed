---
name: "Resource: comment"
summary: A resolved resource that is a comment. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreifertsjgdt6lqfiwvqrmipsb7i2wnarevc7eutfvztszjl3xoun4u
---
This document describes the **seed-resource-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:WM00tRcd -->

# Shape <!-- id:EAMFXFtn -->

A **closed struct** with these fields: <!-- id:CTozbhjz -->
  - `type` _(required)_ — `string` enum: `comment` <!-- id:ZLI-MfCl -->
  - `id` _(required)_ — [seed-id](./seed-id.md) <!-- id:UInd1qiG -->
  - `comment` _(required)_ — [seed-comment](./seed-comment.md) <!-- id:YUJFaUl6 -->

# Depends on <!-- id:Mg_oNLnv -->

- [seed-comment](./seed-comment.md) <!-- id:LtTxleFu -->
- [seed-id](./seed-id.md) <!-- id:ExCrWOlT -->
