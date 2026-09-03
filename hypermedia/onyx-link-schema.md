---
name: Link schema
summary: The variant for a link (CID), optionally naming the expected target type.
schemaDefinition: ipfs://bafyreicjbpeiuhnhmptmweyzryzmtuba6t6qaksxlry3kdcm4hini4mtta
---
This document describes the **onyx-link-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QZ0YT6sU -->

# Shape <!-- id:oZ8Ewg1C -->

A **closed struct** with these fields: <!-- id:f0WtHHnG -->
  - `type` _(required)_ — `string` enum: `link` <!-- id:aINr0L9m -->
  - `ref` — `string` <!-- id:9EpX2r1A -->
  - `name` — `string` <!-- id:l3kcRCy0 -->
  - `description` — `string` <!-- id:X1qTBkc0 -->
  - `params` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:WvvPXIYj -->

# Depends on <!-- id:ZrXqrtqn -->

- [schema](./onyx-schema.md) <!-- id:zSD-j6tg -->
