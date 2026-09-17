---
name: "Example: App Block (Extended Core)"
summary: "How a third party extends the block model: a strict union of Hypermedia’s core blocks plus the app’s own Poll block, rejecting block types it does not know."
schemaDefinition: ipfs://bafyreiandmqf7ddg35mztmnhbjzkild6huchjrq5mp3qy22c3kdgls2t3u
---
How a third party extends the block model: the union of Hypermedia's core blocks PLUS their own custom blocks (here, a Poll). Strict — it accepts core blocks and Polls, and rejects block types it doesn't know. An app validates its documents against this. <!-- id:U9a6O76e -->

This document describes the **example/app-block** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:AqLfI1sF -->

# Shape <!-- id:5oTKaFB5 -->

A **union** — a value matches one of these variants: <!-- id:gD5uxIi- -->
  - [block/core](../block/core.md) <!-- id:TxopPATn -->
  - [example/poll-block](./poll-block.md) <!-- id:6LssErVh -->

# Depends on <!-- id:ccNjEdYm -->

- [example/poll-block](./poll-block.md) <!-- id:wbfKb6k5 -->
- [block/core](../block/core.md) <!-- id:fORBRaGS -->
