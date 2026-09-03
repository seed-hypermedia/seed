---
name: "Resource: document"
summary: A resolved resource that is a document. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreibcypu5y5z3snhucko47vdierffreshbqv5f4pxq3pyfni3dhwrju
---
This document describes the **seed-resource-document** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:osbL_VzO -->

# Shape <!-- id:lpqlXCiW -->

A **closed struct** with these fields: <!-- id:4vWhQD8X -->
  - `type` _(required)_ — `string` enum: `document` <!-- id:-ZUj4U6x -->
  - `id` _(required)_ — [seed-id](./seed-id.md) <!-- id:lPijxTTm -->
  - `document` _(required)_ — [seed-document](./seed-document.md) <!-- id:HFUZ5Hqy -->

# Depends on <!-- id:FEOuuSm1 -->

- [seed-document](./seed-document.md) <!-- id:9L9x-KOf -->
- [seed-id](./seed-id.md) <!-- id:gb8yXdwT -->
