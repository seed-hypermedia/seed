---
name: Query Sort
summary: One sort term for query results, optionally reversed; the app writes lowercase terms and normalizes the older capitalized spellings on read.
---
A **query sort** is one sort term of a [query](../query.md). It says which field orders the results. This schema lists the capitalized spellings `Path`, `Title`, `CreateTime`, `UpdateTime`, `DisplayTime` and `ActivityTime`, which some stored [documents](../protocol/documents.md) use. The [Seed app](../software/desktop.md) writes the unified form `{term, reverse}`. Its `term` is `title`, `path`, `created`, `updated`, `displayTime` or `activity`, and `reverse` means descending. Readers turn the capitalized spellings into the unified ones. The capitalized time terms sort newest first by default, so readers flip their `reverse` flag on the way in. <!-- id:cM9JrMZu -->

# See also <!-- id:CUT8i_ty -->

- [query](../query.md): the query that holds sort terms. <!-- id:pUHAyg9c -->
- [query/inclusion](./inclusion.md): where results come from. <!-- id:oPSqS7_a -->
- [block/query](../block/query.md): the [block](../protocol/blocks.md) that renders a query. <!-- id:Pyl0xdzZ -->
- [Query grammar](../build/query-grammar.md): sorting in the Explore grammar. <!-- id:9Yc80jG7 -->
