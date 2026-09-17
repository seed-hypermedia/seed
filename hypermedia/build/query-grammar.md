---
name: Query grammar
summary: The one query language that Explore, the CLI, the SDK and Seed Agents share for finding documents by their attributes, the DocumentFilter it compiles to, and the attribute listings that tell you which keys exist.
---
Every Hypermedia document carries attributes: its metadata, from `name` and `summary` to any key a schema or a person adds. The query grammar is one short string that says which documents you mean by those attributes, `status="In Progress" AND priority>=3`, and it is understood identically by the Explore surface in the Seed app, the Seed CLI's `query --where`, the SDK and the `query` tool of Seed Agents. Underneath, every surface compiles it to the same `DocumentFilter` that the daemon's `QueryDocuments` call evaluates. <!-- id:OYIudbfN -->

This page is the reference for the grammar, the filter and the attribute listings. Full-text search is a different tool: `Search` ranks words; a query matches attributes exactly. <!-- id:gCGe8JOf -->

# The grammar <!-- id:ves_HELe -->

``` <!-- id:_nKOkfiT -->
key=value     key="two words"     key!=value     key>=3     key<10     compare (typed: string, integer, boolean)
key:text      key~text                                                  contains, case-insensitive
key^text                                                                starts with
has:key       missing:key                                               presence
in:<space uid>    in:<hm:// url>                                        scope to a space or a document subtree
path:/specs       path:/specs/*                                         exact path, or a path prefix
type:document|block|comment|space|contact                               result type (Explore only)
AND   OR   NOT   ( … )                                                  boolean structure; adjacency is AND
free words   "quoted phrases"                                           full-text terms (Explore only)
view:table   cols:title,status   sort:status,-priority                  presentation directives
```

Keys are attribute names; nested keys are dotted (`address.city:Berlin`). Values with spaces are quoted. A number compares as an integer and `true`/`false` as booleans, so `priority>=3` and `done=true` are typed comparisons, while `priority="3"` compares a string. Parsing is forgiving: a malformed part becomes a diagnostic, never an error, and a query serializes back to a stable string. <!-- id:bSb7X1_H -->

Examples: <!-- id:pcdMQ6vr -->

<!-- id:v9RufyAX -->
| Query <!-- col:sdNC81sj --> | Finds <!-- col:_-VgHBJM --> <!-- id:g60Mc4ia --> |
| --- | --- |
| `attributesSchema=hm://<uid>/types/person` | every document typed by that schema <!-- id:pIhTUeU- --> |
| `in:hm://<uid>/places kind=fortress` | fortresses under one subtree <!-- id:HZzR9mBo --> |
| `has:childAttributesSchema` | every typed folder, anywhere <!-- id:LHzMCyGu --> |
| `status="In Progress" AND priority>=3` | open, important work <!-- id:0NVoBs46 --> |
| `path:/specs/* AND NOT has:reviewedBy` | specs nobody has reviewed <!-- id:k12JoC5u --> |
| `title^Draft OR summary:draft` | drafts by name or by summary <!-- id:1XxFmi5z --> |

Two parts of the grammar belong to Explore alone. `type:` chooses what kind of result to show, and bare words are full-text terms that Explore sends to search; the CLI, the SDK compiler and the agents tool report them as diagnostics and ignore them, because `QueryDocuments` matches attributes only. The `view:`, `cols:` and `sort:` directives are presentation: Explore renders a table with those columns, and the CLI and agents map `sort:` onto the request's sort. <!-- id:2UmGW3On -->

# The filter it compiles to <!-- id:cvnAsOu2 -->

`QueryDocuments` takes `{filter?, sort?, pageSize?, pageToken?}` and returns `{documents, nextPageToken}`, where each document comes with its full metadata. The filter is a tree: <!-- id:jurOuodZ -->

<!-- id:Cxl6fhjD -->
| Node <!-- col:kcipHqPo --> | Shape <!-- col:Zd_eOsJA --> | Meaning <!-- col:gvVFrlA7 --> <!-- id:w4-nHL7P --> |
| --- | --- | --- |
| `and` | `{and: {filters: […]}}` | all match; empty matches everything <!-- id:MJTbSXYT --> |
| `or` | `{or: {filters: […]}}` | any matches; empty matches nothing <!-- id:6VegxCKY --> |
| `not` | `{not: {filter}}` | inverts <!-- id:ZJesvVGX --> |
| `comparison` | `{comparison: {key, operator, value}}` | `operator` is `EQUAL`, `NOT_EQUAL`, `LESS_THAN`, `LESS_THAN_OR_EQUAL`, `GREATER_THAN`, `GREATER_THAN_OR_EQUAL`; `value` is `{stringValue}`, `{intValue}` or `{boolValue}` <!-- id:i_GTyQOR --> |
| `exists`, `missing` | `{exists: {key}}`, `{missing: {key}}` | presence <!-- id:jW0HkeOY --> |
| `stringMatch` | `{stringMatch: {key, value, prefix?, caseSensitive?}}` | contains, or starts-with with `prefix` <!-- id:BetumC9f --> |
| `spaceMatch` | `{spaceMatch: {space}}` | one account <!-- id:nfztgjHb --> |
| `pathMatch` | `{pathMatch: {path, prefix?}}` | a path, or everything under it <!-- id:tnHfmVbm --> |
| `urlMatch` | `{urlMatch: {url, prefix?}}` | an `hm://` URL, or its subtree <!-- id:7ldFCyWq --> |

`sort` is a list of `{key, descending?}` for a user attribute or `{attribute, descending?}` for a built-in field: `NAME`, `PATH`, `CREATE_TIME`, `UPDATE_TIME`, `ACTIVITY_TIME`, `COMMENT_COUNT`. Pages are `pageSize` wide (the agents tool allows up to 100) and continue with the returned `nextPageToken`. <!-- id:tWlNXZJ7 -->

The grammar maps onto this directly: `key=value` is a `comparison`, `key:text` a `stringMatch`, `key^text` a `stringMatch` with `prefix`, `has:` an `exists`, `in:` a `spaceMatch` or `urlMatch`, `path:` a `pathMatch`. When a query runs inside one site, the compiler adds that site's `urlMatch` so results stay within it. <!-- id:NkoYXfSa -->

Over HTTP, `QueryDocuments` is a `POST /api/QueryDocuments` whose body is the request as protobuf JSON, and the answer is protobuf JSON too, not the superjson envelope the other keys use; the [Seed API](./web-api.md) page has the transport. The three query encodings matter only when you bypass the SDK. <!-- id:16VXvag6 -->

# Attribute listings <!-- id:_42Wv7fB -->

Before you query you usually want to know which keys exist and what values they take. Two calls answer that, and both are cheap: <!-- id:Ds06UUTK -->
  - `ListDocumentAttributeNames{account?, parentPath?, prefix?, recursive?, pageSize?, pageToken?}` lists the attribute names in use, with the kinds seen for each (string, int, bool, object). `parentPath` lists the children of a nested object; `recursive` lists complete dotted scalar paths instead. `account` puts one space first. <!-- id:cJnLwzn0 -->
  - `ListDocumentAttributeValues{path, kind, account?, prefix?, pageSize?, pageToken?}` lists the distinct values one key has been seen with, for one scalar kind. `account` restricts to a space. <!-- id:V8JW9oNO -->

# Working with it <!-- id:g0eWbGIb -->

## In the Seed app <!-- id:jtk9GYwo -->

Explore is the query grammar with a UI: type a query, get a list or a table, and the `view:`, `cols:` and `sort:` directives are what the table controls write back into the string. Query blocks inside documents use the older `Query` request (a directory listing with sort and limit), not this grammar; see [Query](../query.md). <!-- id:PwG5nSTD -->

## CLI <!-- id:tiibHzPs -->

```sh <!-- id:JSFLDO7o -->
seed-cli query <space> -w 'status="In Progress" AND priority>=3' --sort-by priority --reverse
seed-cli query '*' -w 'attributesSchema=hm://<uid>/types/person' -l 50
seed-cli query <space> --filter '{"exists":{"key":"reviewedBy"}}'       # a raw filter, ANDed with -w
seed-cli query <space> -w '…' --page-token <token>                     # the next page
seed-cli attributes <space>                                             # keys in use, with kinds
seed-cli attributes <space> --parent address --recursive
seed-cli attributes <space> --values status --kind string --prefix In
```

`query` without `-w`, `--filter` or `*` is a plain directory listing (`Children` or `AllDescendants`) through the `Query` request. `-q` prints one `hm://` id and name per line. See [Seed CLI](./cli.md). <!-- id:_In3_iNp -->

## SDK <!-- id:jJNUFZbC -->

The grammar lives in `@seed-hypermedia/client/explore-query`: `parseExploreQuery(q)` returns `{ast, presentation, diagnostics}`, `serializeExploreQuery` writes it back, `quoteExploreValue` quotes a value, and `compileExploreQuery(parsed, {type: 'node'} | {type: 'site', url})` returns the `filter` (and the full-text terms it could not use). Then `client.request('QueryDocuments', {filter, sort, pageSize, pageToken})`, `client.request('ListDocumentAttributeNames', …)` and `client.request('ListDocumentAttributeValues', …)`. Import the grammar from the client package, never from the app's shared UI package, which wraps it in React state. See [SDK](./sdk.md). <!-- id:ca87XK9L -->

## Web API <!-- id:HReYtQEH -->

`POST /api/QueryDocuments`, `POST /api/ListDocumentAttributeNames`, `POST /api/ListDocumentAttributeValues` with protobuf-JSON bodies; `GET /api/Query?…` for directory listings. See [Seed API](./web-api.md). <!-- id:-pLLMU5r -->

## Agents <!-- id:PsKjae1a -->

Seed Agents call `query` with `{q?, filter?, sort?, pageSize?, pageToken?}` and `attributes` with `{key?, kind?, parent?, recursive?, account?, prefix?, pageSize?, pageToken?}`, both through the `call` verb, with the same grammar and the same filter JSON. The tool descriptions tell the model to use `search` for words and `query` for attributes, and to run `attributes` first to learn the keys. An external agent uses the CLI lines above. See [call](../agent/call.md) and [Using Seed from your own agent](./agents.md). <!-- id:Q-PPApnx -->

# See also <!-- id:UmFeD-YS -->

- [Query](../query.md) and the query block, [Metadata](../metadata.md), [Typed documents](../schema/typed-documents.md) <!-- id:WuhrH0aB -->
- [Search](../rpc/search.md) for full text <!-- id:gjdZoZRm -->
