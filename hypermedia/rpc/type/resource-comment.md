---
name: "Resource: Comment"
summary: "A resolved resource that is a comment: the parsed id plus the comment read model."
schemaDefinition: ipfs://bafyreifh4ympsbhu6enq2voev5zysuaneaasbtfxql3vuvxdxots2qnadu
---
This page describes the **rpc/type/resource-comment** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:WM00tRcd -->

# Shape <!-- id:EAMFXFtn -->

A **closed struct** with these fields: <!-- id:CTozbhjz -->
  - `type` _(required)_: `"comment"` <!-- id:ZLI-MfCl -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:UInd1qiG -->
  - `comment` _(required)_: [rpc/type/comment](./comment.md) <!-- id:YUJFaUl6 -->

# Depends on <!-- id:Mg_oNLnv -->

- [rpc/type/comment](./comment.md) <!-- id:LtTxleFu -->
- [rpc/type/id](./id.md) <!-- id:ExCrWOlT -->
