---
name: DeleteBlocks op
summary: Delete blocks by id.
schemaDefinition: ipfs://bafyreievz3mztp3zpu5duce6gybqoqdyuoq7lonei2cxjhidpnnzk6oy6y
---
This document describes the **hypermedia-op-delete-blocks** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:O5i7-yOi -->

# Shape <!-- id:ZBAbxMDE -->

A **closed struct** with these fields: <!-- id:hVjHrQ0n -->
  - `type` _(required)_ — `string` enum: `DeleteBlocks` <!-- id:zKHm9p4w -->
  - `blocks` _(required)_ — list of [string](./onyx-string.md) <!-- id:C3LbdbSU -->

# Depends on <!-- id:MskatxS8 -->

- [string](./onyx-string.md) <!-- id:_2S5kV0V -->
