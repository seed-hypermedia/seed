---
name: Document
summary: The base Hypermedia document — resolved metadata (including the schema-binding fields `schema`, `childrenSchema`, `schemaDefinition`) plus the content block tre
schemaDefinition: ipfs://bafyreid257feamen7vlkpwg6n6hjabvn5skt24lp3es4py6qdu7xp5q7fa
---
The base Hypermedia document — resolved metadata (including the schema-binding fields `schema`, `childrenSchema`, `schemaDefinition`) plus the content block tree. Every typed document schema EXTENDS this via `ref: hm://seed.hyper.media/document`, refining `metadata` (e.g. requiring an extra field) and/or `content`. A document's effective conformance schema is its metadata's `schema`, or — for a child — its parent's `childrenSchema`. <!-- id:qIPS3d4t -->

This document describes the **hypermedia-document** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Kc-oFVmL -->

# Shape <!-- id:2f5svJlU -->

A **closed struct** with these fields: <!-- id:3x9xTU5x -->
  - `metadata` — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:JqWmcBXD -->
  - `content` — list of [hypermedia-block-node](./hypermedia-block-node.md) <!-- id:7I3IBxKI -->

# Depends on <!-- id:S3YgMiYc -->

- [hypermedia-block-node](./hypermedia-block-node.md) <!-- id:4_ANAoOp -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:ZuflGkc7 -->
