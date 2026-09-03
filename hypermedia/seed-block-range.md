---
name: Block range
summary: "A selection within a block: either character offsets (start/end) or the whole block expanded. A derived read model computed by the Seed daemon/API for clients —"
schemaDefinition: ipfs://bafyreidx4mbdethxy6c6wmxk4rf5u2hoygwit47adbs2xr2w3nidntasbm
---
A selection within a block: either character offsets (start/end) or the whole block expanded. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:cbPv3bBq -->

This document describes the **seed-block-range** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:bzJECgs2 -->

# Shape <!-- id:_ySLGKVQ -->
A **closed struct** with these fields: <!-- id:N88QDkke -->
  - `start` — `integer` <!-- id:sZD7rgCl -->
  - `end` — `integer` <!-- id:sqGFTb5g -->
  - `expanded` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:uWwInii1 -->

# Depends on <!-- id:JTmQ38m4 -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:-9DkLtVZ -->