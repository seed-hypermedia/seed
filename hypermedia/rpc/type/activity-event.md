---
name: Activity Event
summary: "One event of the activity feed, currently an open map because the event union is not yet pinned down schema-side."
schemaDefinition: ipfs://bafyreighcdnpfewr2gho4l3rw5z6qiabsj4pex3dx3vcbmumj7yodigpsu
---
One event of the activity feed. The event union is not yet pinned down schema-side, so this is an open map — tightening it is tracked follow-up work. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ohvGePiV -->

This page describes the **rpc/type/activity-event** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:ZYDbAobO -->

# Shape <!-- id:jk2YPQ-- -->

An **open map** — every value: [any](../../any.md). <!-- id:sBIDM6B6 -->

# Depends on <!-- id:ZdlPpe18 -->

- [any](../../any.md) <!-- id:sc0AkmF_ -->
