---
name: "Resource: Document"
summary: A resolved resource that is a document. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreibj7qjisb2pkbybsxzz5nya74m3vw625qujzgpdlgxsais5o74xi4
---
This document describes the **rpc/type/resource-document** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:osbL_VzO -->

# Shape <!-- id:lpqlXCiW -->

A **closed struct** with these fields: <!-- id:4vWhQD8X -->
  - `type` _(required)_ — `"document"` <!-- id:-ZUj4U6x -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:lPijxTTm -->
  - `document` _(required)_ — [rpc/type/document](./document.md) <!-- id:HFUZ5Hqy -->

# Depends on <!-- id:FEOuuSm1 -->

- [rpc/type/document](./document.md) <!-- id:9L9x-KOf -->
- [rpc/type/id](./id.md) <!-- id:gb8yXdwT -->
