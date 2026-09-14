---
name: "Example: Document"
summary: example/document — an example schema.
schemaDefinition: ipfs://bafyreif75bbjni3spbhhkvb6tfdneh5fwp556zstakr4kj4cmexfyevkle
---
This document describes the **example/document** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:llTZrE7Q -->

# Shape <!-- id:yS4WhWFT -->

A **closed struct** with these fields: <!-- id:fuIZuu-D -->
  - `title` _(required)_ — [string](../schema/string.md) <!-- id:idLG8YKz -->
  - `author` — `link` → [example/person](./person.md) <!-- id:ja_Lj9E4 -->
  - `body` — [bytes](../schema/bytes.md) <!-- id:VeUW9ia0 -->
  - `previous` — `link` → [example/document](./document.md) <!-- id:Zlm4QYLV -->

# Depends on <!-- id:WgGKV3_j -->

- [example/person](./person.md) <!-- id:1pB09QSc -->
- [bytes](../schema/bytes.md) <!-- id:WFEB7HHQ -->
- [string](../schema/string.md) <!-- id:NfuhhcxV -->
