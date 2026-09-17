---
name: "Example: Constrained Record"
summary: "A record that shows the value constraints: string length and pattern, numeric bounds, and list size."
schemaDefinition: ipfs://bafyreidkkiy5evkn5tm37vdg5zfr6dnmt45a5nc2w6bydfd6znwpeavayu
---
A record that shows value constraints: a `username` with `minLength`, `maxLength` and `pattern`, a `score` between 0 and 100, and a list of one to three `tags`. [Scalar schemas](../schema/scalar-schema.md) and [list schemas](../schema/list-schema.md) describe the constraint keywords. <!-- id:DGQIN9Bl -->

This page describes the **example/constrained** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:7mil43v3 -->

# Shape <!-- id:u0bp8N-O -->

A **closed struct** with these fields: <!-- id:XZkJ0jr0 -->
  - `username` _(required)_: `string` <!-- id:baxMEaLA -->
  - `score` _(required)_: `integer` <!-- id:MU1mTe3O -->
  - `tags`: list of [string](../string.md) <!-- id:mA94BPqd -->

# Depends on <!-- id:OQmAkkji -->

- [string](../string.md) <!-- id:iav6y69T -->

# See also <!-- id:3PE7LcMW -->

- [Scalar schema](../schema/scalar-schema.md): string and number constraints. <!-- id:7qMrCcRj -->
- [List schema](../schema/list-schema.md): list size constraints. <!-- id:QpOURc7B -->
- [stats](./stats.md): bounded integers in a real type. <!-- id:NVFKMz0C -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:fYCBWAao -->
