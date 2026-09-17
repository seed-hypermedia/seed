---
name: "Example: Comment"
summary: A comment with an author and replies, which are themselves comments.
schemaDefinition: ipfs://bafyreiefhnws225azp7qxfunpnxwp6p3p37225bsgtrvtevavtuhnvignu
---
A comment with a required `text`, an author [link](../link.md) to a [person](./person.md), and `replies` that link to more comments. The type refers to itself, which works because schemas [reference each other by name](../schema/references.md). <!-- id:Vg9fAokU -->

This page describes the **example/comment** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:eEEczx8i -->

# Shape <!-- id:AXyKri0d -->

A **closed struct** with these fields: <!-- id:3Otnxlec -->
  - `text` _(required)_: [string](../string.md) <!-- id:bu5Hac5I -->
  - `author`: `link` → [example/person](./person.md) <!-- id:WYmBsELU -->
  - `replies`: list of `link` → [example/comment](./comment.md) <!-- id:QBOcn3S2 -->

# Depends on <!-- id:lneTxSMU -->

- [example/person](./person.md) <!-- id:g8oGaQtn -->
- [string](../string.md) <!-- id:9yUAwscV -->

# See also <!-- id:7ei96NKH -->

- [References](../schema/references.md): why named references allow recursion. <!-- id:oUU_kc5t -->
- [tree](./tree.md): another self-referencing type. <!-- id:2Zqpcm-2 -->
- [Comment](../comment.md): the real signed comment blob. <!-- id:E1DEnYKw -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:14VICyI_ -->
