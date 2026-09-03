---
name: Navigation item
summary: "One entry of a site's navigation menu, stored in document metadata: a link with display text."
schemaDefinition: ipfs://bafyreih3daykjxaux6yho6pengardzfigg6xohkbt32sj23lwderi5mcui
---
This document describes the **hypermedia-navigation-item** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qG6VHGQm -->

# Shape <!-- id:dvycGapW -->

A **closed struct** with these fields: <!-- id:Mu8YSSfc -->
  - `type` _(required)_ — `string` enum: `Link` <!-- id:Q8-nnpcx -->
  - `id` _(required)_ — [string](./onyx-string.md) <!-- id:WEDCihgA -->
  - `text` _(required)_ — [string](./onyx-string.md) <!-- id:rF9qJUPE -->
  - `link` _(required)_ — [string](./onyx-string.md) <!-- id:9jmT0dlV -->

# Depends on <!-- id:jX5d4-tm -->

- [string](./onyx-string.md) <!-- id:vc-qjhSN -->
