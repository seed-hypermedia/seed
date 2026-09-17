---
name: Block Range
summary: "A selection within a block, either as character offsets (start and end) or as the whole block expanded."
schemaDefinition: ipfs://bafyreigyopiiv7gs5tnho7yblsi3bhm2lexmgd4jtby6vh5gzshuimsnn4
---
A selection within a block: either character offsets (start/end) or the whole block expanded. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:cbPv3bBq -->

This page describes the **rpc/type/block-range** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:bzJECgs2 -->

# Shape <!-- id:_ySLGKVQ -->

A **closed struct** with these fields: <!-- id:N88QDkke -->
  - `start` — `integer` <!-- id:sZD7rgCl -->
  - `end` — `integer` <!-- id:sqGFTb5g -->
  - `expanded` — [boolean](../../boolean.md) <!-- id:uWwInii1 -->

# Depends on <!-- id:JTmQ38m4 -->

- [boolean](../../boolean.md) <!-- id:-9DkLtVZ -->
