---
name: Navigation item
summary: "One entry of a site's navigation menu, stored in document metadata: a link with display text."
schemaDefinition: ipfs://bafyreie6ktz3wsoagvjvcq7s6fax3aftqp72hoqfn3snyj67e6bx7grbou
---
This document describes the **schema/navigation-item** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qG6VHGQm -->

# Shape <!-- id:dvycGapW -->

A **closed struct** with these fields: <!-- id:Mu8YSSfc -->
  - `type` _(required)_ — `"Link"` <!-- id:Q8-nnpcx -->
  - `id` _(required)_ — [string](./string.md) <!-- id:WEDCihgA -->
  - `text` _(required)_ — [string](./string.md) <!-- id:rF9qJUPE -->
  - `link` _(required)_ — [string](./string.md) <!-- id:9jmT0dlV -->

# Depends on <!-- id:jX5d4-tm -->

- [string](./string.md) <!-- id:vc-qjhSN -->
