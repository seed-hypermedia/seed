---
name: External comment group
summary: A comment thread from ANOTHER document that cites this one, with its target's metadata payload. A derived read model computed by the Seed daemon/API for clients
schemaDefinition: ipfs://bafyreib6ulj55xy6ge2zpsr6slacxa4mczvmnwmtd3uelqolirxjkkzkuy
---
A comment thread from ANOTHER document that cites this one, with its target's metadata payload. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:IQ1q6cc0 -->

This document describes the **seed-external-comment-group** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:RaXFBiUz -->

# Shape <!-- id:PPPTPxbz -->

A **closed struct** with these fields: <!-- id:cipbf9F9 -->
  - `comments` _(required)_ — list of [seed-comment](./seed-comment.md) <!-- id:qmdxLO_A -->
  - `moreCommentsCount` _(required)_ — `integer` <!-- id:-VwVHou7 -->
  - `id` _(required)_ — [string](./onyx-string.md) <!-- id:WG16mV8b -->
  - `target` _(required)_ — [seed-metadata-payload](./seed-metadata-payload.md) <!-- id:orsrQswM -->
  - `type` _(required)_ — `string` enum: `externalCommentGroup` <!-- id:tH1zI9sl -->

# Depends on <!-- id:GONsXZm0 -->

- [string](./onyx-string.md) <!-- id:FI8ROgf3 -->
- [seed-comment](./seed-comment.md) <!-- id:HUGkQkES -->
- [seed-metadata-payload](./seed-metadata-payload.md) <!-- id:Q5L7rBRv -->
