---
name: "Example: Blob"
summary: A binary payload tagged with a MIME type and optional size.
schemaDefinition: ipfs://bafyreiagmn66psfhgnngedpf7zknwpwvvxn44bd4vrzxrogg2dpat2vkxu
---
This document describes the **example-blob** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:_Qxmk6wX -->

# Shape <!-- id:vesnh_LB -->

A **closed struct** with these fields: <!-- id:v5doVNjp -->
  - `mime` _(required)_ — [string](./onyx-string.md) <!-- id:MN-579Cf -->
  - `size` — [integer](./onyx-integer.md) <!-- id:tB72shxZ -->
  - `data` _(required)_ — [bytes](./onyx-bytes.md) <!-- id:Q_T-l5Cr -->

# Depends on <!-- id:CyOF5f4t -->

- [bytes](./onyx-bytes.md) <!-- id:X1u_H1kI -->
- [integer](./onyx-integer.md) <!-- id:v3gQbJMy -->
- [string](./onyx-string.md) <!-- id:P1GB2FQT -->
