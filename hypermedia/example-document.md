---
name: "Example: Document"
summary: example-document — an example schema.
schemaDefinition: ipfs://bafyreicqw6ldqav2u3rhlmywfka7l5pfsyk63mykv4wdxcf5zexj6ttzze
---
This document describes the **example-document** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:llTZrE7Q -->

# Shape <!-- id:yS4WhWFT -->

A **closed struct** with these fields: <!-- id:fuIZuu-D -->
  - `title` _(required)_ — [string](./onyx-string.md) <!-- id:idLG8YKz -->
  - `author` — `link` → [example-person](./example-person.md) <!-- id:ja_Lj9E4 -->
  - `body` — [bytes](./onyx-bytes.md) <!-- id:VeUW9ia0 -->
  - `previous` — `link` → [example-document](./example-document.md) <!-- id:Zlm4QYLV -->

# Depends on <!-- id:WgGKV3_j -->

- [example-person](./example-person.md) <!-- id:1pB09QSc -->
- [bytes](./onyx-bytes.md) <!-- id:WFEB7HHQ -->
- [string](./onyx-string.md) <!-- id:NfuhhcxV -->
