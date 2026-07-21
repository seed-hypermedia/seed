---
name: "Document"
summary: "The base Hypermedia document — resolved metadata (including the schema-binding fields `schema`, `childrenSchema`, `schemaDefinition`) plus the content block tre"
---

# Document

The base Hypermedia document — resolved metadata (including the schema-binding fields `schema`, `childrenSchema`, `schemaDefinition`) plus the content block tree. Every typed document schema EXTENDS this via `ref: hm://seed.hyper.media/document`, refining `metadata` (e.g. requiring an extra field) and/or `content`. A document's effective conformance schema is its metadata's `schema`, or — for a child — its parent's `childrenSchema`.


This document describes the **hypermedia-document** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata)
- `content` — list of [hypermedia-block-node](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-node)

## Depends on

- [hypermedia-block-node](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-node)
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata)
