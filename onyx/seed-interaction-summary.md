---
name: "Interaction summary"
summary: "Aggregate interaction counts for a document — citations, comments, changes, child documents, distinct authors — plus per-block citation/comment counts. A derive"
---

# Interaction summary

Aggregate interaction counts for a document — citations, comments, changes, child documents, distinct authors — plus per-block citation/comment counts. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-interaction-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `citations` *(required)* — `integer`
- `comments` *(required)* — `integer`
- `changes` *(required)* — `integer`
- `children` *(required)* — `integer`
- `authorUids` — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `blocks` *(required)* — map ⟨ * : map { 2 fields } ⟩

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
