---
name: Query block payload
summary: "Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/A"
schemaDefinition: ipfs://bafyreieu3oqyeye3wkmcpydsqyfdgoe3mngk73etyoqidc2qznb7j2sada
---
Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:VzSZH5xA -->

This document describes the **seed-query-block-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:OsEQqtxV -->

# Shape <!-- id:a4jQ1u0u -->

A **closed struct** with these fields: <!-- id:DyS_qKTz -->
  - `queryTargetName` _(required)_ — [string](./onyx-string.md) <!-- id:lpgzgCDx -->
  - `in` _(required)_ — [seed-id](./seed-id.md) <!-- id:PaNXccq8 -->
  - `results` _(required)_ — list of [seed-document-info](./seed-document-info.md) <!-- id:pqVQymXu -->
  - `mode` — `string` enum: `Children` `AllDescendants` <!-- id:HKi67-Wj -->
  - `interactionSummaries` _(required)_ — map ⟨ \* : [seed-query-block-item-summary](./seed-query-block-item-summary.md) ⟩ <!-- id:EqpWvaWn -->
  - `accountsMetadata` _(required)_ — [seed-accounts-metadata](./seed-accounts-metadata.md) <!-- id:UpOdUnhj -->

# Depends on <!-- id:ooVpqrDK -->

- [string](./onyx-string.md) <!-- id:z5cuCUEY -->
- [seed-accounts-metadata](./seed-accounts-metadata.md) <!-- id:J1qY7Tl5 -->
- [seed-document-info](./seed-document-info.md) <!-- id:IBffstpK -->
- [seed-id](./seed-id.md) <!-- id:VjUau-KS -->
- [seed-query-block-item-summary](./seed-query-block-item-summary.md) <!-- id:3DKOCjfE -->
