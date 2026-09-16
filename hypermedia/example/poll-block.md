---
name: "Example: Poll Block (Custom)"
summary: "An example third-party block type: a poll with a question and options. It extends the shared block base, exactly like a core block."
schemaDefinition: ipfs://bafyreif5zw6mkx4ioyhxg4ivsjgjviwhevvoe7j6u4twlfpyn662tun7wi
---
This document describes the **example/poll-block** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:UMzXooSA -->

# Shape <!-- id:aF0A6qUJ -->

**Extends** [block/base](../block/base.md) with these added fields: <!-- id:AU7ub5dT -->
  - `type` — `"Poll"` <!-- id:a5Im9O50 -->
  - `question` _(required)_ — [string](../string.md) <!-- id:MVAEf3cE -->
  - `options` _(required)_ — list of [string](../string.md) <!-- id:pU77dcCF -->
  - `attributes` — map { 3 fields } <!-- id:jJ3NLW4y -->

# Depends on <!-- id:czM-qx6F -->

- [block/base](../block/base.md) <!-- id:JO2qNB-c -->
- [block/children-type](../block/children-type.md) <!-- id:RHMZeOH4 -->
- [any](../any.md) <!-- id:Ljf2W4Wk -->
- [boolean](../boolean.md) <!-- id:-D8eUkTH -->
- [float](../float.md) <!-- id:6y4r4lDq -->
- [string](../string.md) <!-- id:w5tshfF6 -->
