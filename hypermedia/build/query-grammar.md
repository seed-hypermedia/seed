---
name: Query grammar
summary: The query grammar is one short language for finding documents by their attributes, shared by Explore, the CLI, the SDK and Seed Agents.
---
The query grammar is a short way to say which [documents](../protocol/documents.md) you want. You write one line, such as `status="In Progress" AND priority>=3`, and you get the documents that match.

A query matches attributes. A document's attributes are its [metadata](../metadata.md): `name`, `summary`, and any key that a [schema](../schema.md) or a person adds. Four programs read the grammar the same way: Explore in the [Seed app](../software/desktop.md), `query --where` in the [Seed CLI](./cli.md), the [SDK](./sdk.md), and the `query` tool of [Seed Agents](../agent.md). Each one turns the line into the same `DocumentFilter`, and the [daemon](../software/daemon.md)'s `QueryDocuments` call runs it. <!-- id:OYIudbfN -->

This page is the reference for the grammar, the filter and the attribute listings. Two other tools do different jobs. Full-text search (`Search`) ranks words, while a query matches attributes exactly. A directory listing uses the [Query](../query.md) type, with its includes, sort and limit. That is what a [query block](../block/query.md) stores, and it does not use this grammar. <!-- id:gCGe8JOf -->

# The grammar <!-- id:ves_HELe -->

``` <!-- id:_nKOkfiT -->
key=value     key="two words"     key!=value     key>=3     key<10     compare (typed: string, integer, boolean)
key:text      key~text                                                  contains, case-insensitive
key^text                                                                starts with
has:key       missing:key       empty:key                               presence; empty = missing, or an empty string
"Due Date"=x    has:"Depends On"                                       a key with spaces is quoted
in:<space uid>    in:<hm:// url>                                        scope to a space or a document subtree
path:/specs       path:/specs/*                                         exact path, or a path prefix
$author:<uid>     $created>=2026-09-01     $updated<2026-10-01          built-in fields: any one author; create or update time
type:document|block|comment|space|contact                               result type (Explore only)
AND   OR   NOT   ( … )                                                  boolean structure; adjacency is AND
free words   "quoted phrases"                                           full-text terms (Explore only)
view:table   cols:title,status   sort:status,-priority                  presentation directives
```

The rules:

- Keys and exact (`=`) values are case-sensitive, so `Priority=High` does not match `priority: high`. `key:text` ignores case.
- Keys are attribute names. Nested keys are dotted (`address.city:Berlin`).
- Quote a value that has spaces.
- A value made of digits compares as an integer, and `true`/`false` as booleans. So `priority>=3` and `done=true` are typed comparisons.
- A quoted value is always a string: `version="3"` compares with the string `3`, and `version=3` with the integer.
- `key!=value` matches only documents that have the key. `NOT key=value` also matches documents without it.
- `empty:key` is short for `(missing:key OR key="")`, which is what a blank field in a table usually is.
- Only single values (string, integer, boolean) are indexed. (These are metadata values, not [blocks](../protocol/blocks.md) of content.) You cannot match an attribute that holds a list by its items.
- The parser never fails. A part it cannot read becomes a diagnostic, and the rest of the query still runs.
- A parsed query writes back to the same string every time. <!-- id:bSb7X1_H -->

Examples: <!-- id:pcdMQ6vr -->

<!-- id:v9RufyAX -->
| Query <!-- col:sdNC81sj --> | Finds <!-- col:_-VgHBJM --> <!-- id:g60Mc4ia --> |
| --- | --- |
| `attributesSchema=hm://<uid>/types/person` | every document typed by that schema, including the children a folder types through its `childAttributesSchema` <!-- id:pIhTUeU- --> |
| `in:hm://<uid>/places kind=fortress` | fortresses under one subtree <!-- id:HZzR9mBo --> |
| `has:childAttributesSchema` | every typed folder, anywhere <!-- id:LHzMCyGu --> |
| `status="In Progress" AND priority>=3` | open, important work <!-- id:0NVoBs46 --> |
| `path:/specs/* AND NOT has:reviewedBy` | specs nobody has reviewed <!-- id:k12JoC5u --> |
| `name^Draft OR summary:draft` | drafts by name or by summary <!-- id:1XxFmi5z --> |

Two parts of the grammar work in Explore only. `type:` chooses what kind of result to show, and bare words are full-text terms that Explore sends to search. The SDK compiler returns them separately as text terms. The CLI and the agents tool warn about them and ignore them, because `QueryDocuments` matches attributes only.

The `view:`, `cols:` and `sort:` directives say how to show the results. Explore draws a table with those columns and sorts by `sort:`. The CLI ignores all three and takes sorting from `--sort`, `--sort-by` and `--reverse`. The agents tool ignores `view:` and `cols:` but does read `sort:`, and it also takes a `sort` input. <!-- id:2UmGW3On -->

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
| `spaceMatch` | `{spaceMatch: {space}}` | one [account](../protocol/identity.md) <!-- id:nfztgjHb --> |
| `pathMatch` | `{pathMatch: {path, prefix?}}` | a path, or everything under it <!-- id:tnHfmVbm --> |
| `urlMatch` | `{urlMatch: {url, prefix?}}` | an `hm://` URL, or its subtree <!-- id:7ldFCyWq --> |
| `authorMatch` | `{authorMatch: {author}}` | any one of the document's authors |
| `timeRange` | `{timeRange: {field, start?, end?}}` | `field` is `CREATE_TIME` or `UPDATE_TIME`; the time lies between two RFC 3339 instants; `start` is inclusive, `end` is exclusive |

A filter node holds exactly one of these twelve members.

`sort` is a list of `{key, descending?}` for a user attribute or `{attribute, descending?}` for a built-in field. Over the Seed API and the SDK the built-in names are `BUILTIN_SORT_ATTRIBUTE_NAME`, `BUILTIN_SORT_ATTRIBUTE_PATH`, `BUILTIN_SORT_ATTRIBUTE_CREATE_TIME`, `BUILTIN_SORT_ATTRIBUTE_UPDATE_TIME`, `BUILTIN_SORT_ATTRIBUTE_ACTIVITY_TIME` and `BUILTIN_SORT_ATTRIBUTE_COMMENT_COUNT`. The agents' `query` tool takes the short form: `NAME`, `PATH`, `CREATE_TIME`, `UPDATE_TIME`, `ACTIVITY_TIME`, `COMMENT_COUNT`. Pages are `pageSize` wide (the agents tool allows up to 100) and continue with the returned `nextPageToken`. <!-- id:tWlNXZJ7 -->

The grammar maps onto this directly. `key=value` is a `comparison`, `key:text` a `stringMatch`, `key^text` a `stringMatch` with `prefix`, `has:` an `exists`, `in:` a `spaceMatch` or `urlMatch`, `path:` a `pathMatch`, `$author:` an `authorMatch`, and `$created` or `$updated` a `timeRange`. Built-in fields carry a `$` so they never clash with your own attributes: `$author:<account uid>` matches any one of a document's authors, and `$created` and `$updated` take `<`, `<=`, `>`, `>=` against an ISO date or date-time; a bare date covers its whole UTC day, so `$created<=2026-09-01` includes the 1st. In a shell, single-quote such a query, since `$` is expanded inside double quotes. When a query runs inside one [site](../protocol/sites.md), the compiler adds that site's `urlMatch` so results stay within it. <!-- id:NkoYXfSa -->

Over HTTP, `QueryDocuments` is a `POST /api/QueryDocuments` whose body is the request as protobuf JSON. The answer is protobuf JSON too, unlike the superjson envelope the other keys use. The [Seed API](./web-api.md) page explains how requests are sent. <!-- id:16VXvag6 -->

# Attribute listings <!-- id:_42Wv7fB -->

Before you query, you usually want to know which keys exist and what values they take. Two calls answer that, and both are fast: <!-- id:Ds06UUTK -->
  - `ListDocumentAttributeNames{account?, parentPath?, prefix?, recursive?, pageSize?, pageToken?}` lists the attribute names in use, with the kinds seen for each (string, int, bool, object). `parentPath` lists the children of a nested object. `recursive` lists complete dotted scalar paths instead. `account` puts the names used in one [space](../protocol/spaces.md) first, and still lists the others. <!-- id:cJnLwzn0 -->
  - `ListDocumentAttributeValues{path, kind, account?, prefix?, pageSize?, pageToken?}` lists the distinct values one key has been seen with, for one scalar kind. Here `account` limits the values to one space. <!-- id:V8JW9oNO -->

# Working with it <!-- id:g0eWbGIb -->

## In the Seed app <!-- id:jtk9GYwo -->

Explore is the query grammar with a UI. You type a query and get a list or a table. The table controls write the `view:`, `cols:` and `sort:` directives back into the string. [Query blocks](../block/query.md) inside documents use the older `Query` request (a directory listing with sort and limit) and do not use this grammar. See [Query](../query.md). <!-- id:PwG5nSTD -->

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

## Seed API <!-- id:HReYtQEH -->

`POST /api/QueryDocuments`, `POST /api/ListDocumentAttributeNames`, `POST /api/ListDocumentAttributeValues` with protobuf-JSON bodies. `GET /api/Query?…` serves directory listings. See [Seed API](./web-api.md). <!-- id:-pLLMU5r -->

## Agents <!-- id:PsKjae1a -->

Seed Agents call `query` with `{q?, filter?, sort?, pageSize?, pageToken?}` and `attributes` with `{key?, kind?, parent?, recursive?, account?, prefix?, pageSize?, pageToken?}`, both through the [`call`](../agent/call.md) verb, with the same grammar and the same filter JSON. The tool descriptions tell the model to use `search` for words and `query` for attributes, and to run `attributes` first to learn the keys. An external agent uses the CLI lines above. See [call](../agent/call.md) and [Using Seed from your own agent](./agents.md). <!-- id:Q-PPApnx -->

# See also <!-- id:UmFeD-YS -->

- [Query](../query.md) and the query block <!-- id:WuhrH0aB -->
- `Search` on the [Seed API](./web-api.md) for full text <!-- id:gjdZoZRm -->
- [Metadata](../metadata.md) <!-- id:RcHJjty_ -->
- [Typed documents](../schema/typed-documents.md) <!-- id:WwNggx8d -->
- [Seed CLI](./cli.md) <!-- id:PxwRyb9v -->
- [SDK](./sdk.md) <!-- id:1sNaOk0I -->
