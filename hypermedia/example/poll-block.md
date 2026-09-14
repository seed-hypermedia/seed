---
name: "Example: Poll Block (Custom)"
summary: "An example third-party block type: a poll with a question and options. It extends the shared block base, exactly like a core block."
schemaDefinition: ipfs://bafyreia6ia32bkvhwluizoefq5u665apisom6qdpehf4cfnm2t73bgvxpi
---
This document describes the **example/poll-block** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:UMzXooSA -->

# Shape <!-- id:aF0A6qUJ -->

**Extends** [schema/block/base](../schema/block/base.md) with these added fields: <!-- id:AU7ub5dT -->
  - `type` — `"Poll"` <!-- id:a5Im9O50 -->
  - `question` _(required)_ — [string](../schema/string.md) <!-- id:MVAEf3cE -->
  - `options` _(required)_ — list of [string](../schema/string.md) <!-- id:pU77dcCF -->
  - `attributes` — map { 3 fields } <!-- id:jJ3NLW4y -->

# Depends on <!-- id:czM-qx6F -->

- [schema/block/base](../schema/block/base.md) <!-- id:JO2qNB-c -->
- [schema/block/children-type](../schema/block/children-type.md) <!-- id:RHMZeOH4 -->
- [any](../schema/any.md) <!-- id:Ljf2W4Wk -->
- [boolean](../schema/boolean.md) <!-- id:-D8eUkTH -->
- [float](../schema/float.md) <!-- id:6y4r4lDq -->
- [string](../schema/string.md) <!-- id:w5tshfF6 -->
