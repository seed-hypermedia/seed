---
name: Navigation item
summary: "One entry of a site's navigation menu, stored in document metadata: a link with display text."
schemaDefinition: ipfs://bafyreiexmspnzsukur3eskmrf7e6t7rxaeky6xf67ikcoysjtz4dcrp4ia
---
This document describes the **metadata/navigation-item** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qG6VHGQm -->

# Shape <!-- id:dvycGapW -->

A **closed struct** with these fields: <!-- id:Mu8YSSfc -->
  - `type` _(required)_ — `"Link"` <!-- id:Q8-nnpcx -->
  - `id` _(required)_ — [string](../string.md) <!-- id:WEDCihgA -->
  - `text` _(required)_ — [string](../string.md) <!-- id:rF9qJUPE -->
  - `link` _(required)_ — [string](../string.md) <!-- id:9jmT0dlV -->

# Depends on <!-- id:jX5d4-tm -->

- [string](../string.md) <!-- id:vc-qjhSN -->
