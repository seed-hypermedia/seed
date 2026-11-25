---
name: Query
summary: "A live document query: which spaces and paths to include, how to sort, and an optional limit; the payload of a Query block and of the Query request."
---
A **query** asks for a list of [documents](./protocol/documents.md) and stays up to date. It says which [spaces](./protocol/spaces.md) and paths to include, how to sort the results, and how many to return at most. A [query block](./block/query.md) stores a query in its attributes. The Query API takes the same object as its input. <!-- id:rWL5NDLS -->

`includes` is a list of [inclusions](./query/inclusion.md). Each one names a space, an optional path prefix, and a mode: `Children` or `AllDescendants`. `sort` is a list of [sort terms](./query/sort.md), and the [daemon](./software/daemon.md) applies the first one. `limit` caps the number of results. The [Seed API](./build/web-api.md)'s `Query` and `QueryBlock` requests take this object, and return the info and metadata of each matching document. Attribute filters are a different feature. They belong to the `QueryDocuments` request and the Explore grammar, described in [the query grammar](./build/query-grammar.md). <!-- id:OBxcfpcf -->

# See also <!-- id:jPq0vaPI -->

- [block/query](./block/query.md): the block that renders a query. <!-- id:AO8ip2Zz -->
- [query/inclusion](./query/inclusion.md) and [query/sort](./query/sort.md): the parts of a query. <!-- id:YC5Rqz8M -->
- [Seed API](./build/web-api.md): the `Query` request. <!-- id:se_1Vo9V -->
- [Query grammar](./build/query-grammar.md): attribute filters and `QueryDocuments`. <!-- id:2jWXGkNg -->
- [Blocks](./protocol/blocks.md): query blocks in documents. <!-- id:qyGfS0vL -->

# Pages in this section <!-- id:W8ssg6Wl attrs:{"childrenType":"Grid","columnCount":3} -->

<./query/inclusion.md> <!-- id:uBSicOPZ type:Embed attrs:{"view":"Card"} -->

<./query/sort.md> <!-- id:gOJbHsNy type:Embed attrs:{"view":"Card"} -->

<./query/style.md> <!-- id:6TzQWJje type:Embed attrs:{"view":"Card"} -->

<./query/table-config.md> <!-- id:FcxdHcQk type:Embed attrs:{"view":"Card"} -->
