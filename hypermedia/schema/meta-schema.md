---
name: Onyx schema
summary: "The meta-schema: a discriminated union of the shapes a schema can take. It is a valid instance of itself."
schemaDefinition: ipfs://bafyreieroepmqw34dvcpgcusakgkl7c2rh4pyrfdfnyuofor3snuk5aiku
---
**Meta-schema** — `schema/meta-schema`: the schema that describes what a schema is. A **discriminated union** of nine map variants and the four literal kinds; a valid instance of itself, and the system's axiom — the one block whose type is known out of band. <!-- id:bXl0LFcD -->

This document describes the **schema/meta-schema** type — the meta-schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:y93xpe-t -->

# Shape <!-- id:4QWuviLU -->

A **union** — a value matches one of these variants: <!-- id:r_pDx306 -->
  - [map-schema](./map-schema.md) <!-- id:8o35KJdz -->
  - [list-schema](./list-schema.md) <!-- id:Q3vpoo1- -->
  - [scalar-schema](./scalar-schema.md) <!-- id:XcNAJyGU -->
  - [link-schema](./link-schema.md) <!-- id:vq_S_Dm7 -->
  - [include-schema](./include-schema.md) <!-- id:ZjHtnpFj -->
  - [union-schema](./anyof.md) <!-- id:n9qz4ea3 -->
  - [var-schema](./var-schema.md) <!-- id:VY7nFwdc -->
  - [literal-schema](./literal-schema.md) <!-- id:KZ3BNjsi -->
  - [string](./string.md) — a bare string is a literal schema <!-- id:yqpTFSKq -->
  - [integer](./integer.md) — a bare integer is a literal schema <!-- id:c3PPOXHO -->
  - [boolean](./boolean.md) — a bare boolean is a literal schema <!-- id:-cxXCWv7 -->
  - [null](./null.md) — null is a literal schema <!-- id:6_sGlZ9l -->

# Depends on <!-- id:_7aiQPhA -->

- [boolean](./boolean.md) <!-- id:ReFegJmw -->
- [include-schema](./include-schema.md) <!-- id:sgBDWijw -->
- [integer](./integer.md) <!-- id:xEEWZo_C -->
- [link-schema](./link-schema.md) <!-- id:A4p8bq5A -->
- [list-schema](./list-schema.md) <!-- id:wC1FNIlK -->
- [literal-schema](./literal-schema.md) <!-- id:7GZkoLpS -->
- [map-schema](./map-schema.md) <!-- id:G0zPLoYK -->
- [null](./null.md) <!-- id:DOl7wGGz -->
- [scalar-schema](./scalar-schema.md) <!-- id:6GlNvB4Q -->
- [string](./string.md) <!-- id:wRRFFgG5 -->
- [union-schema](./anyof.md) <!-- id:GFJNvn_u -->
- [var-schema](./var-schema.md) <!-- id:hRHhpE13 -->
