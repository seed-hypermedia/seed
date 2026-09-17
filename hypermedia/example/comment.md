---
name: "Example: Comment"
summary: A comment with an author and replies, which are themselves comments.
schemaDefinition: ipfs://bafyreiefhnws225azp7qxfunpnxwp6p3p37225bsgtrvtevavtuhnvignu
---
This document describes the **example/comment** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:eEEczx8i -->

# Shape <!-- id:AXyKri0d -->

A **closed struct** with these fields: <!-- id:3Otnxlec -->
  - `text` _(required)_: [string](../string.md) <!-- id:bu5Hac5I -->
  - `author`: `link` → [example/person](./person.md) <!-- id:WYmBsELU -->
  - `replies`: list of `link` → [example/comment](./comment.md) <!-- id:QBOcn3S2 -->

# Depends on <!-- id:lneTxSMU -->

- [example/person](./person.md) <!-- id:g8oGaQtn -->
- [string](../string.md) <!-- id:9yUAwscV -->
