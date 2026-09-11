---
name: "Example: Blob"
summary: A binary payload tagged with a MIME type and optional size.
schemaDefinition: ipfs://bafyreieqxpjnyzodq77lt5r7xwbjddekxabjoq74hdrq5xzfagbxcfalxq
---
This document describes the **example-blob** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:_Qxmk6wX -->

# Shape <!-- id:vesnh_LB -->

A **closed struct** with these fields: <!-- id:v5doVNjp -->
  - `mime` _(required)_ — [string](./hypermedia-string.md) <!-- id:MN-579Cf -->
  - `size` — [integer](./hypermedia-integer.md) <!-- id:tB72shxZ -->
  - `data` _(required)_ — [bytes](./hypermedia-bytes.md) <!-- id:Q_T-l5Cr -->

# Depends on <!-- id:CyOF5f4t -->

- [bytes](./hypermedia-bytes.md) <!-- id:X1u_H1kI -->
- [integer](./hypermedia-integer.md) <!-- id:v3gQbJMy -->
- [string](./hypermedia-string.md) <!-- id:P1GB2FQT -->
