---
name: "Example: Document"
summary: A document with a title, an author, a body, and a link to a previous document.
---
A document with a required `title`, an author [link](../link.md) to a [person](./person.md), a [bytes](../bytes.md) body, and `previous`, a link to another document. The type refers to itself through `previous`, which works because schemas [reference each other by name](../schema/references.md). <!-- id:vukEa947 -->

This page describes the **example/document** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:llTZrE7Q -->

# See also <!-- id:1-eFcEO_ -->

- [References](../schema/references.md): why named references allow recursion. <!-- id:KJA-TebD -->
- [comment](./comment.md): another self-referencing type. <!-- id:dm3FDtim -->
- [The fixpoint problem](../schema/fixpoint-problem.md): why hashes cannot form cycles. <!-- id:ye4Pt3FW -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:oYknD0zj -->
