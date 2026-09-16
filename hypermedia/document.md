---
name: Document
summary: The base Hypermedia document — resolved metadata (including the schema-binding fields `attributesSchema`, `childAttributesSchema`, `schemaDefinition`) plus the content block tre
schemaDefinition: ipfs://bafyreib5e75e5btubdpbkpn7iifyxcnh2ekphhm4bq4wr3vsoeom6dbz6e
---
The base Hypermedia document — resolved metadata (including the schema-binding fields `attributesSchema`, `childAttributesSchema`, `schemaDefinition`) plus the content block tree. A typed document does not extend this: it names an attributes schema — a struct describing its metadata fields — through `attributesSchema`, or inherits one from its parent's `childAttributesSchema`. <!-- id:qIPS3d4t -->

This document describes the **document** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Kc-oFVmL -->

# Shape <!-- id:2f5svJlU -->

A **closed struct** with these fields: <!-- id:3x9xTU5x -->
  - `metadata` — [metadata](./metadata.md) <!-- id:JqWmcBXD -->
  - `content` — list of [block/node](./block/node.md) <!-- id:7I3IBxKI -->

# Depends on <!-- id:S3YgMiYc -->

- [block/node](./block/node.md) <!-- id:4_ANAoOp -->
- [metadata](./metadata.md) <!-- id:ZuflGkc7 -->
