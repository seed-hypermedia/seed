---
name: Redirect Info
summary: "Marks a listed document as a redirect to another target, optionally republishing its content in place."
schemaDefinition: ipfs://bafyreiaski2t4sdupe4p6q5mzjqkaecgwwnwwl5epvjtlpwp4wnngnbtby
---
This page describes the **rpc/type/redirect-info** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:2gKj4ehA -->

# Shape <!-- id:kTlL78Cl -->

A **closed struct** with these fields: <!-- id:H9UhYokL -->
  - `type` _(required)_: `"redirect"` <!-- id:BJPYeobL -->
  - `target` _(required)_: [string](../../string.md) <!-- id:yhCOxGRG -->
  - `republish`: [boolean](../../boolean.md) <!-- id:jjdxxctm -->

# Depends on <!-- id:uX4Hsf16 -->

- [boolean](../../boolean.md) <!-- id:ViQ8FoIh -->
- [string](../../string.md) <!-- id:uzKMxK4F -->
