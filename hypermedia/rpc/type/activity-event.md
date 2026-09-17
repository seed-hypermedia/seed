---
name: Activity Event
summary: One event of the activity feed, currently an open map because the event union is not yet pinned down schema-side.
---
One event of the activity feed that [rpc/list-events](../list-events.md) pages through. The event union is not pinned down in the schema yet, so this is an open map. Tightening it is tracked follow-up work. <!-- id:ohvGePiV -->

This page describes the **rpc/type/activity-event** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:ZYDbAobO -->

# See also <!-- id:xwc4R5Rs -->

- [ListEvents](../list-events.md): the method that returns events. <!-- id:NFFKgs_s -->
- [Activity Summary](./activity-summary.md): the latest-activity digest on listings. <!-- id:MmRcqU9V -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:ePFc9Y1m -->
