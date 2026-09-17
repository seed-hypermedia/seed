---
name: "Example: File"
summary: "A file with a name and a link to its parent folder."
schemaDefinition: ipfs://bafyreigndhu2brizsp5exnyzrrwut5ktce4nt56fk6ndp6nbhxymu73axi
---
A file with a required `name` and a `parent` [link](../link.md) to its [folder](./folder.md). File and folder refer to each other, which works because schemas [reference each other by name](../schema/references.md).

This page describes the **example/file** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:3vFag6Mh -->

# Shape <!-- id:Q0wy8br3 -->

A **closed struct** with these fields: <!-- id:s0wTKzxN -->
  - `name` _(required)_: [string](../string.md) <!-- id:CcwT0871 -->
  - `parent`: `link` → [example/folder](./folder.md) <!-- id:deMPQl1o -->

# Depends on <!-- id:edXncEYg -->

- [example/folder](./folder.md) <!-- id:5Zt97ayp -->
- [string](../string.md) <!-- id:5W_mczb- -->

# See also

- [folder](./folder.md): the other half of the pair.
- [entry](./entry.md): a union of the two.
- [References](../schema/references.md): why mutual recursion works.
- [Examples](../example.md): every example, grouped by feature.
