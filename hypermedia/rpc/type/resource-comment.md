---
name: "Resource: Comment"
summary: A resolved resource that is a comment. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreiescibnbj6j43sqcepqzclnn4i2fl6wun3vd4b67g742rekaoi3oe
---
This document describes the **rpc/type/resource-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:WM00tRcd -->

# Shape <!-- id:EAMFXFtn -->

A **closed struct** with these fields: <!-- id:CTozbhjz -->
  - `type` _(required)_ — `"comment"` <!-- id:ZLI-MfCl -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:UInd1qiG -->
  - `comment` _(required)_ — [rpc/type/comment](./comment.md) <!-- id:YUJFaUl6 -->

# Depends on <!-- id:Mg_oNLnv -->

- [rpc/type/comment](./comment.md) <!-- id:LtTxleFu -->
- [rpc/type/id](./id.md) <!-- id:ExCrWOlT -->
