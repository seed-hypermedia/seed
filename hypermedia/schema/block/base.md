---
name: Block (base)
summary: "Fields shared by every concrete block type: id, optional revision, and the type discriminator. Concrete blocks extend this."
schemaDefinition: ipfs://bafyreidqgnqpegcifgbfqa6ias24a6hx2nrxoqpcfm6b5ft2ikshgphqla
---
This document describes the **schema/block/base** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ibCqRoF1 -->

# Shape <!-- id:QptDZ4s_ -->

A **closed struct** with these fields: <!-- id:oaPUbuet -->
  - `id` _(required)_ — [string](../string.md) <!-- id:HJepUEoZ -->
  - `revision` — [string](../string.md) <!-- id:wOo3etTY -->
  - `type` _(required)_ — [string](../string.md) <!-- id:Lsihdw38 -->

# Depends on <!-- id:WX3NBBPn -->

- [string](../string.md) <!-- id:3isavs_Q -->
