---
name: Query Sort
summary: "One sort term for query results, optionally reversed; the app writes lowercase terms and normalizes the older capitalized spellings on read."
schemaDefinition: ipfs://bafyreihszez3pnfy6xxrkmcbunrytrrg4trwblkkipxjv7fubvnmtzdpnm
---
A **query sort** is one sort term of a [query](../query.md). The values this schema lists (`Path`, `Title`, `CreateTime`, `UpdateTime`, `DisplayTime`, `ActivityTime`) are the original spellings, still present in older documents. The Seed app now writes the unified form `{term, reverse}` with `title`, `path`, `created`, `updated`, `displayTime` or `activity`, where `reverse` means descending. Readers normalize the old spellings to the new ones. The old time terms sorted newest-first by default, so their `reverse` flag is flipped on the way in.

# Shape <!-- id:P0EJDwNB -->

A **closed struct** with these fields: <!-- id:9JJXnFXo -->
  - `reverse`: [boolean](../boolean.md) <!-- id:d_agsTi8 -->
  - `term` _(required)_: one of `"Path"` | `"Title"` | `"CreateTime"` | `"UpdateTime"` | `"DisplayTime"` | `"ActivityTime"` <!-- id:GeGLwkRQ -->

# Depends on <!-- id:qCmEO3j- -->

- [boolean](../boolean.md) <!-- id:ycEmiVRJ -->

# See also

- [query](../query.md): the query that holds sort terms.
- [query/inclusion](./inclusion.md): where results come from.
- [block/query](../block/query.md): the block that renders a query.
- [Query grammar](../build/query-grammar.md): sorting in the Explore grammar.
