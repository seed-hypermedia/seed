---
name: "Example: Blob"
summary: A binary payload tagged with a MIME type and optional size.
schemaDefinition: ipfs://bafyreighpalkczawiueg2ms7c2zx4bwes66eh6nosid32iqs6sih4wbwvi
---
A binary payload: [bytes](../bytes.md) in `data`, a required MIME type string in `mime`, and an optional `size`. [article](./article.md) links to one as its cover.

This page describes the **example/blob** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:_Qxmk6wX -->

# Shape <!-- id:vesnh_LB -->

A **closed struct** with these fields: <!-- id:v5doVNjp -->
  - `mime` _(required)_: [string](../string.md) <!-- id:MN-579Cf -->
  - `size`: [integer](../integer.md) <!-- id:tB72shxZ -->
  - `data` _(required)_: [bytes](../bytes.md) <!-- id:Q_T-l5Cr -->

# Depends on <!-- id:CyOF5f4t -->

- [bytes](../bytes.md) <!-- id:X1u_H1kI -->
- [integer](../integer.md) <!-- id:v3gQbJMy -->
- [string](../string.md) <!-- id:P1GB2FQT -->

# See also

- [Bytes](../bytes.md): raw binary data.
- [article](./article.md): links to a blob.
- [Files](../protocol/files.md): how Seed stores real files.
- [Examples](../example.md): every example, grouped by feature.
