---
name: Onyx schema
summary: "The meta-schema: a discriminated union of the shapes a schema can take. It is a valid instance of itself."
schemaDefinition: ipfs://bafyreifbl5i5khrt5er2xuks5y2tauqbr6h35bk2wsfdiw643c3quec7iy
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

# Depends on <!-- id:_7aiQPhA -->

- [include-schema](./hypermedia-include-schema.md) <!-- id:sgBDWijw -->
- [link-schema](./hypermedia-link-schema.md) <!-- id:A4p8bq5A -->
- [list-schema](./hypermedia-list-schema.md) <!-- id:wC1FNIlK -->
- [map-schema](./hypermedia-map-schema.md) <!-- id:G0zPLoYK -->
- [scalar-schema](./hypermedia-scalar-schema.md) <!-- id:6GlNvB4Q -->
- [union-schema](./hypermedia-anyof.md) <!-- id:GFJNvn_u -->
- [var-schema](./hypermedia-var-schema.md) <!-- id:hRHhpE13 -->
