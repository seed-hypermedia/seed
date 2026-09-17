---
name: "Example: File"
summary: example/file — an example schema.
schemaDefinition: ipfs://bafyreigndhu2brizsp5exnyzrrwut5ktce4nt56fk6ndp6nbhxymu73axi
---
This document describes the **example/file** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:3vFag6Mh -->

# Shape <!-- id:Q0wy8br3 -->

A **closed struct** with these fields: <!-- id:s0wTKzxN -->
  - `name` _(required)_: [string](../string.md) <!-- id:CcwT0871 -->
  - `parent`: `link` → [example/folder](./folder.md) <!-- id:deMPQl1o -->

# Depends on <!-- id:edXncEYg -->

- [example/folder](./folder.md) <!-- id:5Zt97ayp -->
- [string](../string.md) <!-- id:5W_mczb- -->
