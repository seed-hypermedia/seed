---
name: DeleteBlocks Op
summary: Delete blocks by id.
schemaDefinition: ipfs://bafyreifgmya24hxpzucvnpvmosmer6p6grfzmmqv5uuzo7zmhhozevmlh4
---
This document describes the **change/op/delete-blocks** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:O5i7-yOi -->

# Shape <!-- id:ZBAbxMDE -->

A **closed struct** with these fields: <!-- id:hVjHrQ0n -->
  - `type` _(required)_ — `"DeleteBlocks"` <!-- id:zKHm9p4w -->
  - `blocks` _(required)_ — list of [string](../../string.md) <!-- id:C3LbdbSU -->

# Depends on <!-- id:MskatxS8 -->

- [string](../../string.md) <!-- id:_2S5kV0V -->
