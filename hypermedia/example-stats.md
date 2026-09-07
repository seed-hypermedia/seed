---
name: Character stats
summary: "A character's attribute block — the object a character page links to from its `stats` field. Lives as its own DAG-CBOR blob (an `ipfs://` reference), so it can "
schemaDefinition: ipfs://bafyreibw3qz3gkewthzjpblpja23ukgozm3adsrhd33bhbzrwvyjzke6m4
---
A character's attribute block — the object a character page links to from its `stats` field. Lives as its own DAG-CBOR blob (an `ipfs://` reference), so it can hold integers and enums that document metadata cannot. <!-- id:oHLwcXC5 -->

This document describes the **example-stats** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qiyJLpb0 -->

# Shape <!-- id:F-O470TV -->

A **closed struct** with these fields: <!-- id:G2YL1Yf3 -->
  - `strength` _(required)_ — `integer` (1–10) <!-- id:Z9r2yevr -->
  - `intellect` _(required)_ — `integer` (1–10) <!-- id:VbVkvo-D -->
  - `charisma` _(required)_ — `integer` (1–10) <!-- id:RKip766b -->
  - `alignment` — [string](./hypermedia-string.md) (one of `lawful`, `neutral`, `chaotic`) <!-- id:yokYx90K -->
  - `traits` — list of [string](./hypermedia-string.md) <!-- id:g0sFEEZM -->

# Depends on <!-- id:gbkbOHZl -->

- [string](./hypermedia-string.md) <!-- id:mX_FWlal -->
