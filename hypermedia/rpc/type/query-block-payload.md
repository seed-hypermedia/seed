---
name: Query block payload
summary: "Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/A"
schemaDefinition: ipfs://bafyreidzbpl4r424w5xcauf3cfx2f3i3pigdtd43q7j65tkq6il34ztjzu
---
Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:VzSZH5xA -->

This document describes the **rpc/type/query-block-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:OsEQqtxV -->

# Shape <!-- id:a4jQ1u0u -->

A **closed struct** with these fields: <!-- id:DyS_qKTz -->
  - `queryTargetName` _(required)_ — [string](../../schema/string.md) <!-- id:lpgzgCDx -->
  - `in` _(required)_ — [rpc/type/id](./id.md) <!-- id:PaNXccq8 -->
  - `results` _(required)_ — list of [rpc/type/document-info](./document-info.md) <!-- id:pqVQymXu -->
  - `mode` — one of `"Children"` | `"AllDescendants"` <!-- id:HKi67-Wj -->
  - `interactionSummaries` _(required)_ — map ⟨ \* : [rpc/type/query-block-item-summary](./query-block-item-summary.md) ⟩ <!-- id:EqpWvaWn -->
  - `accountsMetadata` _(required)_ — [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:UpOdUnhj -->

# Depends on <!-- id:ooVpqrDK -->

- [string](../../schema/string.md) <!-- id:z5cuCUEY -->
- [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:J1qY7Tl5 -->
- [rpc/type/document-info](./document-info.md) <!-- id:IBffstpK -->
- [rpc/type/id](./id.md) <!-- id:VjUau-KS -->
- [rpc/type/query-block-item-summary](./query-block-item-summary.md) <!-- id:3DKOCjfE -->
