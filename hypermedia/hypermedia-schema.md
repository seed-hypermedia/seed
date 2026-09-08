---
name: Onyx schema
summary: "The meta-schema: a discriminated union of the shapes a schema can take. It is a valid instance of itself."
schemaDefinition: ipfs://bafyreihtndrodq46olmhks7ogfwbdynzcaysznz2l554y6haemwrel66vq
---
This document describes the **hypermedia-schema** type — the meta-schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:y93xpe-t -->

# Shape <!-- id:4QWuviLU -->

A **union** — a value matches one of these variants: <!-- id:r_pDx306 -->
  - [map-schema](./hypermedia-map-schema.md) <!-- id:8o35KJdz -->
  - [list-schema](./hypermedia-list-schema.md) <!-- id:Q3vpoo1- -->
  - [scalar-schema](./hypermedia-scalar-schema.md) <!-- id:XcNAJyGU -->
  - [link-schema](./hypermedia-link-schema.md) <!-- id:vq_S_Dm7 -->
  - [include-schema](./hypermedia-include-schema.md) <!-- id:ZjHtnpFj -->
  - [union-schema](./hypermedia-anyof.md) <!-- id:n9qz4ea3 -->
  - [var-schema](./hypermedia-var-schema.md) <!-- id:VY7nFwdc -->
  - [literal-schema](./hypermedia-literal-schema.md) <!-- id:KZ3BNjsi -->
  - [string](./hypermedia-string.md) — a bare string is a literal schema <!-- id:yqpTFSKq -->
  - [integer](./hypermedia-integer.md) — a bare integer is a literal schema <!-- id:c3PPOXHO -->
  - [boolean](./hypermedia-boolean.md) — a bare boolean is a literal schema <!-- id:-cxXCWv7 -->
  - [null](./hypermedia-null.md) — null is a literal schema <!-- id:6_sGlZ9l -->

# Depends on <!-- id:_7aiQPhA -->

- [boolean](./hypermedia-boolean.md) <!-- id:ReFegJmw -->
- [include-schema](./hypermedia-include-schema.md) <!-- id:sgBDWijw -->
- [integer](./hypermedia-integer.md) <!-- id:xEEWZo_C -->
- [link-schema](./hypermedia-link-schema.md) <!-- id:A4p8bq5A -->
- [list-schema](./hypermedia-list-schema.md) <!-- id:wC1FNIlK -->
- [literal-schema](./hypermedia-literal-schema.md) <!-- id:7GZkoLpS -->
- [map-schema](./hypermedia-map-schema.md) <!-- id:G0zPLoYK -->
- [null](./hypermedia-null.md) <!-- id:DOl7wGGz -->
- [scalar-schema](./hypermedia-scalar-schema.md) <!-- id:6GlNvB4Q -->
- [string](./hypermedia-string.md) <!-- id:wRRFFgG5 -->
- [union-schema](./hypermedia-anyof.md) <!-- id:GFJNvn_u -->
- [var-schema](./hypermedia-var-schema.md) <!-- id:hRHhpE13 -->
