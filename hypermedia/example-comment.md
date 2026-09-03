---
name: "Example: Comment"
summary: A comment with an author and replies, which are themselves comments.
schemaDefinition: ipfs://bafyreibkba37p5htzqbviqeh7s737x5h5xb3xhmtkrd6fispmvou3mxhqy
---
This document describes the **example-comment** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:eEEczx8i -->

# Shape <!-- id:AXyKri0d -->

A **closed struct** with these fields: <!-- id:3Otnxlec -->
  - `text` _(required)_ — [string](./onyx-string.md) <!-- id:bu5Hac5I -->
  - `author` — `link` → [example-person](./example-person.md) <!-- id:WYmBsELU -->
  - `replies` — list of `link` → [example-comment](./example-comment.md) <!-- id:QBOcn3S2 -->

# Depends on <!-- id:lneTxSMU -->

- [example-person](./example-person.md) <!-- id:g8oGaQtn -->
- [string](./onyx-string.md) <!-- id:9yUAwscV -->
