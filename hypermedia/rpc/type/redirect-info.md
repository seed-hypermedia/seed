---
name: Redirect Info
summary: Marks a listed document as a redirect to another target. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreigngyqbs5y5k7pjag5p72vhvan3i4zbjdggtkibzdyhiynppfs2zu
---
This document describes the **rpc/type/redirect-info** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:2gKj4ehA -->

# Shape <!-- id:kTlL78Cl -->

A **closed struct** with these fields: <!-- id:H9UhYokL -->
  - `type` _(required)_ — `"redirect"` <!-- id:BJPYeobL -->
  - `target` _(required)_ — [string](../../string.md) <!-- id:yhCOxGRG -->
  - `republish` — [boolean](../../boolean.md) <!-- id:jjdxxctm -->

# Depends on <!-- id:uX4Hsf16 -->

- [boolean](../../boolean.md) <!-- id:ViQ8FoIh -->
- [string](../../string.md) <!-- id:uzKMxK4F -->
