---
name: "Example: Document"
summary: A document with a title, an author, a body, and a link to a previous document.
schemaDefinition: ipfs://bafyreida7qlurvn3pe22cgolfnlw2hqncgq2e6qkx6jgzctpquhsngptfu
---
A document with a required `title`, an author [link](../link.md) to a [person](./person.md), a [bytes](../bytes.md) body, and `previous`, a link to another document. The type refers to itself through `previous`, which works because schemas [reference each other by name](../schema/references.md). <!-- id:vukEa947 -->

This page describes the **example/document** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:llTZrE7Q -->

# Shape <!-- id:yS4WhWFT -->

A **closed struct** with these fields: <!-- id:fuIZuu-D -->
  - `title` _(required)_: [string](../string.md) <!-- id:idLG8YKz -->
  - `author`: `link` → [example/person](./person.md) <!-- id:ja_Lj9E4 -->
  - `body`: [bytes](../bytes.md) <!-- id:VeUW9ia0 -->
  - `previous`: `link` → [example/document](./document.md) <!-- id:Zlm4QYLV -->

# Depends on <!-- id:WgGKV3_j -->

- [example/person](./person.md) <!-- id:1pB09QSc -->
- [bytes](../bytes.md) <!-- id:WFEB7HHQ -->
- [string](../string.md) <!-- id:NfuhhcxV -->

# See also <!-- id:1-eFcEO_ -->

- [References](../schema/references.md): why named references allow recursion. <!-- id:KJA-TebD -->
- [comment](./comment.md): another self-referencing type. <!-- id:dm3FDtim -->
- [The fixpoint problem](../schema/fixpoint-problem.md): why hashes cannot form cycles. <!-- id:ye4Pt3FW -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:oYknD0zj -->
