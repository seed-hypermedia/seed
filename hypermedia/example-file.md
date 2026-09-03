---
name: "Example: File"
summary: example-file — an example schema.
schemaDefinition: ipfs://bafyreicyndpg72iyrj7wg7jbxzhkx6lspgzo4qu4x276aeljgns36lsjwi
---
This document describes the **example-file** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:3vFag6Mh -->

# Shape <!-- id:Q0wy8br3 -->

A **closed struct** with these fields: <!-- id:s0wTKzxN -->
  - `name` _(required)_ — [string](./onyx-string.md) <!-- id:CcwT0871 -->
  - `parent` — `link` → [example-folder](./example-folder.md) <!-- id:deMPQl1o -->

# Depends on <!-- id:edXncEYg -->

- [example-folder](./example-folder.md) <!-- id:5Zt97ayp -->
- [string](./onyx-string.md) <!-- id:5W_mczb- -->
