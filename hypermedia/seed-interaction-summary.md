---
name: Interaction summary
summary: Aggregate interaction counts for a document — citations, comments, changes, child documents, distinct authors — plus per-block citation/comment counts. A derive
schemaDefinition: ipfs://bafyreidbymjxw24blfa5iqwpfbq4kh2bohrdis5xsgb7q6wvw7eytbkiue
---
Aggregate interaction counts for a document — citations, comments, changes, child documents, distinct authors — plus per-block citation/comment counts. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:PWw560Ku -->

This document describes the **seed-interaction-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Pz9XkamM -->

# Shape <!-- id:P_kmfRIz -->

A **closed struct** with these fields: <!-- id:ErHfF34X -->
  - `citations` _(required)_ — `integer` <!-- id:2_8ldqeJ -->
  - `comments` _(required)_ — `integer` <!-- id:-x9xLFCo -->
  - `changes` _(required)_ — `integer` <!-- id:Mi6241x6 -->
  - `children` _(required)_ — `integer` <!-- id:trlRp_lK -->
  - `authorUids` — list of [string](./onyx-string.md) <!-- id:tQurr8ya -->
  - `blocks` _(required)_ — map ⟨ \* : map { 2 fields } ⟩ <!-- id:-FgTqWtB -->

# Depends on <!-- id:a54ycyYA -->

- [string](./onyx-string.md) <!-- id:dBRMpu1a -->
