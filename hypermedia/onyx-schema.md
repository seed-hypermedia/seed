---
name: Onyx schema
summary: "The meta-schema: a discriminated union of the shapes a schema can take. It is a valid instance of itself."
schemaDefinition: ipfs://bafyreifrv56gmwkpa5evav44m75qom2ilv7zli6fytd6f6fstwmvxlfh5a
---
This document describes the **onyx-schema** type — the meta-schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:y93xpe-t -->

# Shape <!-- id:4QWuviLU -->

A **union** — a value matches one of these variants: <!-- id:r_pDx306 -->
  - [map-schema](./onyx-map-schema.md) <!-- id:8o35KJdz -->
  - [list-schema](./onyx-list-schema.md) <!-- id:Q3vpoo1- -->
  - [scalar-schema](./onyx-scalar-schema.md) <!-- id:XcNAJyGU -->
  - [link-schema](./onyx-link-schema.md) <!-- id:vq_S_Dm7 -->
  - [include-schema](./onyx-include-schema.md) <!-- id:ZjHtnpFj -->
  - [union-schema](./onyx-union-schema.md) <!-- id:n9qz4ea3 -->
  - [var-schema](./onyx-var-schema.md) <!-- id:VY7nFwdc -->

# Depends on <!-- id:_7aiQPhA -->

- [include-schema](./onyx-include-schema.md) <!-- id:sgBDWijw -->
- [link-schema](./onyx-link-schema.md) <!-- id:A4p8bq5A -->
- [list-schema](./onyx-list-schema.md) <!-- id:wC1FNIlK -->
- [map-schema](./onyx-map-schema.md) <!-- id:G0zPLoYK -->
- [scalar-schema](./onyx-scalar-schema.md) <!-- id:6GlNvB4Q -->
- [union-schema](./onyx-union-schema.md) <!-- id:GFJNvn_u -->
- [var-schema](./onyx-var-schema.md) <!-- id:hRHhpE13 -->
