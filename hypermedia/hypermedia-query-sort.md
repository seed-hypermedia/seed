---
name: Query sort
summary: One sort term for a Query block's results, optionally reversed.
schemaDefinition: ipfs://bafyreibutzzg2az5scloy72cmhi3zodgei2kw7j5wbvsioxjabqbmy5wly
---
This document describes the **hypermedia-query-sort** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:eaWXyOUU -->

# Shape <!-- id:P0EJDwNB -->

A **closed struct** with these fields: <!-- id:9JJXnFXo -->
  - `reverse` — [boolean](./hypermedia-boolean.md) <!-- id:d_agsTi8 -->
  - `term` _(required)_ — one of `"Path"` | `"Title"` | `"CreateTime"` | `"UpdateTime"` | `"DisplayTime"` | `"ActivityTime"` <!-- id:GeGLwkRQ -->

# Depends on <!-- id:qCmEO3j- -->

- [boolean](./hypermedia-boolean.md) <!-- id:ycEmiVRJ -->
