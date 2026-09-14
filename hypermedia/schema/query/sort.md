---
name: Query sort
summary: One sort term for a Query block's results, optionally reversed.
schemaDefinition: ipfs://bafyreie3wtotyt5knfuc5ug5a3c7dph2atp5y7oesga2lmdooesbfussuq
---
This document describes the **schema/query/sort** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:eaWXyOUU -->

# Shape <!-- id:P0EJDwNB -->

A **closed struct** with these fields: <!-- id:9JJXnFXo -->
  - `reverse` — [boolean](../boolean.md) <!-- id:d_agsTi8 -->
  - `term` _(required)_ — one of `"Path"` | `"Title"` | `"CreateTime"` | `"UpdateTime"` | `"DisplayTime"` | `"ActivityTime"` <!-- id:GeGLwkRQ -->

# Depends on <!-- id:qCmEO3j- -->

- [boolean](../boolean.md) <!-- id:ycEmiVRJ -->
