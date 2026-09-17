---
name: Seed API Schemas
summary: The read keys of the Seed API published as Hypermedia Schemas, one page per key with its input and output, and the live console the Seed app builds from them.
---
# One call shape <!-- id:S_OZNfxS -->

Seed apps read from the network through one call of the [Seed API](./build/web-api.md): `request(key, input) → output`. The `key` names a method, such as `Resource`, `Query`, `Search` or `ListComments`. Each method has its own input and output. Each read method is also published as a [schema](./schema.md), and this page describes that catalog. <!-- id:JoVBzIrS -->

# Transport <!-- id:h0phrocI -->

The same keys work over HTTP on every Seed [site](./protocol/sites.md), at `/api/<Key>`. Reads are `GET` requests with the input in the query string. Writes are `POST` requests with a [DAG-CBOR](./schema/dag-cbor.md) body. Responses are JSON wrapped by [superjson](https://github.com/flightcontrolhq/superjson), so the output sits under a top-level `json` member. A few pass-through keys, such as `QueryDocuments`, answer plain protobuf JSON. <!-- id:iyQoDYlt -->

```sh <!-- id:m6WWWHjT -->
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

The [Seed API reference](./build/web-api.md) covers the rest: the three query-string encodings, errors, CORS, authentication, `GET /api/schema`, and the write keys `PublishBlobs` and `PrepareDocumentChange`. The [SDK](./build/sdk.md) and the [Seed CLI](./build/cli.md) make these requests for you. <!-- id:xfryff8e -->

The catalog below covers the read methods only. The write and pass-through keys have no `rpc/<method>` schema yet. <!-- id:TAHiMqXZ -->

# The catalog <!-- id:LJgSGvSR -->

Each method is an `rpc/<method>` schema: a closed map with three properties. `key` is a literal holding the method name, so the schema names itself. `input` points at the schema of what you send. `output` points at the schema of what comes back, often a union with `null` for "not found". For example, [RPC: Query](./rpc/query.md) pins `key = "Query"`, takes a [query](./query.md), and returns a [rpc/type/query-result](./rpc/type/query-result.md) or `null`. A query is the same object a [query block](./protocol/blocks.md) stores in a document. <!-- id:yWqxCdaY -->

[rpc/method](./rpc/method.md) is the union of every method. It is the machine-readable table of contents for the API. Some of its variants: <!-- id:r2qlHKeD -->

<!-- id:J1dn7ZDd -->
| method <!-- col:GL7yOaOJ --> | input <!-- col:Lxoa3SwM --> | output <!-- col:m7CHYxJc --> <!-- id:WsUSQtde --> |
| --- | --- | --- |
| [Resource](./rpc/resource.md) | a parsed id ([rpc/type/id](./rpc/type/id.md)) | a [rpc/type/resource](./rpc/type/resource.md): document, comment, redirect, not-found, tombstone, or error <!-- id:OCaimmjI --> |
| [Query](./rpc/query.md) | a document query | the matching documents with their metadata <!-- id:PRJIbbY7 --> |
| [Search](./rpc/search.md) | a query string, plus optional account scope, filters, and paging | [rpc/type/search-results](./rpc/type/search-results.md) <!-- id:ADnxjXqQ --> |
| [ListComments](./rpc/list-comments.md) | a target [rpc/type/id](./rpc/type/id.md) | a [rpc/type/comment-list](./rpc/type/comment-list.md) <!-- id:Aqr_65-d --> |
| [ListCitations](./rpc/list-citations.md) | a target [rpc/type/id](./rpc/type/id.md) | a `citations` list of [rpc/type/raw-citation](./rpc/type/raw-citation.md) <!-- id:HIm5QCor --> |
| [DiscoveryStatus](./rpc/discovery-status.md) | an account `uid` and `path` (optionally a version) | a [rpc/type/discovery-status](./rpc/type/discovery-status.md) <!-- id:mh6Y_wZC --> |

The union page has the full list. Every variant links to its own page with its exact fields. <!-- id:1IPE6PFM -->

# The read models <!-- id:eNHwY8y6 -->

The `output` side uses the read models under `rpc/type/`. A read model is data the daemon computes for clients. Signed [blobs](./protocol/blobs.md) are what travel the network. [rpc/type/document](./rpc/type/document.md) is a [document](./protocol/documents.md) with its versions, authors and timestamps already resolved. [rpc/type/id](./rpc/type/id.md) is the parsed form of an [hm:// URL](./protocol/urls.md). [rpc/type/interaction-summary](./rpc/type/interaction-summary.md) counts the [comments](./protocol/comments.md), citations and [changes](./change.md) on a [resource](./glossary.md). The schemas for the signed blobs are in [Schemas on the Hypermedia Network](./schema/blobs.md). <!-- id:AqyRPHIN -->

# The console <!-- id:pntyyyx_ -->

In the Seed app, open any `rpc/<method>` page of this library. The page's schema shows above its body, and under the schema is a live call section for that method. You edit the input with the same schema-aware value editor the app uses elsewhere. It starts with the method's required fields and offers dropdowns and reference pickers where the schema allows them. Press **Run** and the app sends the request through its universal client. It then checks the response against the `output` schema and shows **matches schema** or lists the fields that do not match. The [rpc/method](./rpc/method.md) page shows the whole console, with a method picker built from the union. <!-- id:Me1tBVqs -->

Nothing in the console is hand-wired. It reads the `rpc/method` union at runtime, so a method is in the console exactly when its schema is in the library. <!-- id:XJsp5ct- -->

# Why type the API <!-- id:vBYhd6xH -->

- **For people exploring:** the console is a reference you can run. Every field is documented where you fill it in, and every response is checked against its schema. <!-- id:fTzeqoVk -->
- **For agents and tools:** a method's contract is a document you can fetch. An agent, such as one running on [Seed Agents](./agent.md), can read [rpc/search](./rpc/search.md), build a valid input, and know the shape of the answer. <!-- id:vWpJZXpp -->
- **For the codebase:** the generated TypeScript types for the read models come from these schemas. The client, the tests and the documentation share one source. <!-- id:qzV0XwRb -->
- **For catching drift:** if a daemon response stops matching its schema, the console shows the mismatch in red. <!-- id:Ai7Pg1ST -->

# Adding a method <!-- id:bViEZFh5 -->

Add an `rpc/<method>.schema.json` with its `key` literal, `input` and `output`. Add a companion `.md` page and reference the schema from the `rpc/method` union. Run the publisher to update the lockfile, run the generators to refresh the bundled registry and TypeScript types, then sync the folder. The method then shows up in the console and as a typed call in the client. [How Hypermedia Schemas work](./schema/how-it-works.md) describes the pipeline. <!-- id:J_7p0r19 -->

# See also

- [Seed API](./build/web-api.md): HTTP transport, encodings, errors and write keys.
- [RPC](./rpc/method.md): the union of every method.
- [Resource](./rpc/resource.md): the most common read.
- [SDK](./build/sdk.md): typed calls from TypeScript.
- [Hypermedia Schemas](./schema.md): the schema system these pages use.
- [Examples](./example.md): more schemas to read.
