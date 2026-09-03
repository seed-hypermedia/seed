---
name: "Example: Poll block (custom)"
summary: "An example third-party block type: a poll with a question and options. It extends the shared block base, exactly like a core block."
schemaDefinition: ipfs://bafyreibmgnbqq4xz547s4gukzehcf2uqcixfztoatoltk6yrkecmq7ba44
---
This document describes the **example-poll-block** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:UMzXooSA -->

# Shape <!-- id:aF0A6qUJ -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:AU7ub5dT -->
  - `type` — `string` enum: `Poll` <!-- id:a5Im9O50 -->
  - `question` _(required)_ — [string](./onyx-string.md) <!-- id:MVAEf3cE -->
  - `options` _(required)_ — list of [string](./onyx-string.md) <!-- id:pU77dcCF -->
  - `attributes` — map { 3 fields } <!-- id:jJ3NLW4y -->

# Depends on <!-- id:czM-qx6F -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:JO2qNB-c -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:RHMZeOH4 -->
- [any](./onyx-any.md) <!-- id:Ljf2W4Wk -->
- [boolean](./onyx-boolean.md) <!-- id:-D8eUkTH -->
- [float](./onyx-float.md) <!-- id:6y4r4lDq -->
- [string](./onyx-string.md) <!-- id:w5tshfF6 -->
