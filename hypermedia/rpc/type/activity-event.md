---
name: Activity Event
summary: "One event of the activity feed, currently an open map because the event union is not yet pinned down schema-side."
schemaDefinition: ipfs://bafyreighcdnpfewr2gho4l3rw5z6qiabsj4pex3dx3vcbmumj7yodigpsu
---
One event of the activity feed that [rpc/list-events](../list-events.md) pages through. The event union is not pinned down in the schema yet, so this is an open map. Tightening it is tracked follow-up work. <!-- id:ohvGePiV -->

This page describes the **rpc/type/activity-event** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:ZYDbAobO -->

# Shape <!-- id:jk2YPQ-- -->

An **open map**. Every value: [any](../../any.md). <!-- id:sBIDM6B6 -->

# Depends on <!-- id:ZdlPpe18 -->

- [any](../../any.md) <!-- id:sc0AkmF_ -->

# See also

- [ListEvents](../list-events.md): the method that returns events.
- [Activity Summary](./activity-summary.md): the latest-activity digest on listings.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
