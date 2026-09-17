---
name: Activity Summary
summary: "The latest-activity digest carried on document listings: the newest comment or change and the unread state."
---
The latest-activity digest on [document](../../protocol/documents.md) listings: the newest [comment](../../protocol/comments.md) or [change](../../change.md), and the unread state. It is part of [document info](./document-info.md). <!-- id:tbPPJsiv -->

This page describes the **rpc/type/activity-summary** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:bA3oqiOv -->

# See also <!-- id:c8-vjriK -->

- [Document Info](./document-info.md): the listing entry that carries it. <!-- id:L-WJy8YM -->
- [ListEvents](../list-events.md): the full activity feed. <!-- id:5ea6a4LJ -->
- [Interaction Summary](./interaction-summary.md): aggregate counts for a document. <!-- id:zEZSxgdp -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:ORU33oEd -->
