---
name: Network Blobs
summary: How Hypermedia Schemas type the six signed DAG-CBOR blobs of the Hypermedia Network (Change, Ref, Profile, Comment, Capability and Contact), the block model and the Seed API read models.
---
# Schemas for network blobs <!-- id:MZbfGNFo -->

The Hypermedia Network stores its data as [DAG-CBOR](./dag-cbor.md) [blobs](../protocol/blobs.md) in IPFS. There are six signed blob types: [Change](../change.md), [Ref](../ref.md), [Profile](../profile.md), [Comment](../comment.md), [Capability](../capability.md) and [Contact](../contact.md). They are related, because every one embeds the same signed [envelope](../blob.md). These schemas type production data, use only the features of the [schema language](./schema-language.md), and are published under the Hypermedia account: the blob schemas at the root (`change`, `ref`, …) and the block model under `block/`. <!-- id:mIEsrB_H -->

## The shared envelope <!-- id:5NuFY-Ul -->

Every blob embeds a base envelope, [Signed blob](../blob.md): <!-- id:iAwaugHT -->

<!-- id:fmRGB5ga -->
| field <!-- col:QDXqnDiH --> | type <!-- col:Wdc_fgoB --> | meaning <!-- col:FVItG8md --> <!-- id:l8an2_DE --> |
| --- | --- | --- |
| `type` | string | the blob discriminator ("Change", "Ref", …) <!-- id:WLcTiayY --> |
| `signer` | `principal` (bytes) | the signer's public key <!-- id:8zO6tjGh --> |
| `sig` | `signature` (bytes) | signature over the blob <!-- id:lD2RIqxm --> |
| `ts` | `timestamp` (integer) | Unix-millisecond time <!-- id:nFpKKNpd --> |

Each concrete type [extends](./extension.md) the envelope. It inherits those four fields and pins `type` to a [literal](./literal-schema.md): <!-- id:zUkl9LQZ -->
  - `change`: an append-only [document](../protocol/documents.md) change, linked into a causal DAG by `deps`. It carries a [`change/body`](../change/body.md) of ops. <!-- id:XNtWFQFG -->
  - `ref`: a signed pointer from a space and path to the current head Changes. <!-- id:z0t8cH-b -->
  - `profile`: an account's name, avatar and description, or an alias. <!-- id:kuRmAvLb -->
  - `comment`: a threaded [comment](../protocol/comments.md). Its body is a tree of [`block/comment`](../block/comment.md) blocks. <!-- id:4B_lboNh -->
  - `capability`: a delegation of a [`role`](../role.md) (WRITER or AGENT) to a key. <!-- id:04geSQaa -->
  - `contact`: one account's named reference to another. <!-- id:A4ma4Edr -->

Open `change` in the schema explorer. It shows `signer`, `sig` and `ts` as **inherited** and the rest as **added**. The **Dependents** list of `blob` is exactly these six types. <!-- id:S58y-fEh -->

## Define your own signed blob type <!-- id:m8JR3RPQ -->

Any schema that extends [Signed blob](../blob.md) and pins a `type` tag is a signed blob type the app can create. The six built-in types do not reserve the envelope. In the schema editor, tick **Signed blob type**, set the tag (for example `Vote`), add your fields, and publish the type as a schema-definition page. Its **Create** button opens the signing form. You fill in only your fields. The app adds `signer`, `ts` and `sig` at signing time with the selected account's key. It publishes the blob with the convention the daemon verifies: sign the canonical CBOR with the signature zeroed. The result is a verifiable blob on the network. The built-in indexer ignores its `type`, but any app that resolves your schema can trust and render it. Browse any schema, built-in or yours, at `/hm/schema/<cid>`. <!-- id:bcuDPBiZ -->

## The blob union <!-- id:TePpgQkJ -->

[`blob/any`](../blob/any.md) is the [discriminated union](./discriminated-union.md) of all six types, tagged on `type`. You can validate a value against "any Hypermedia blob" as one type. <!-- id:HYLU7eY7 -->

## Nested structure <!-- id:dM0xRByE -->

A Change's body is a list of [ops](../change/op.md). The op schema is itself a union of SetAttributes, MoveBlocks, ReplaceBlock, DeleteBlocks and SetKey. Content is modeled by [`block`](../block.md) and [`annotation`](../block/annotation.md). Both are **open maps**: known fields plus arbitrary inline attributes. Document [metadata](../metadata.md) is an open struct of known keys (`name`, `summary`, `icon`, `cover`, `layout`, …) plus extras. <!-- id:ahKth012 -->

## Block types: a strict core anyone can extend <!-- id:5qbaLYVx -->

Document content is made of [blocks](../protocol/blocks.md). The block model needs two things that conflict. Implementations need **strict, concrete types** so they can dispatch on `block.type` to type-safe handlers. Documents need **openness** so a newer client's block type does not make an older client reject the whole document. One validation pass cannot do both, because an open fallback always accepts a malformed known block. So the model provides layers, and each workflow picks one: <!-- id:6ghDI01J -->

<!-- id:HpD_T3GL -->
| workflow <!-- col:SJYqm_FR --> | needs <!-- col:zZHghcu8 --> | use <!-- col:rop7Xg0X --> <!-- id:vpbDuOwM --> |
| --- | --- | --- |
| rendering / dispatch | strict per-type shapes + graceful fallback | concrete types + `block` <!-- id:2Rqie-wF --> |
| authoring / editing | strict validation | `block/core` <!-- id:ZTfLAdj0 --> |
| sync / storage (forward-compat) | never reject unknown | `block` <!-- id:23bmRunT --> |
| codegen | the enumerable set | `block/core` <!-- id:L8JGoNbX --> |

<!-- id:nNN-eoL8 -->
- The fifteen **concrete blocks** are `block/paragraph`, `block/heading`, `block/code`, `block/math`, `block/image`, `block/video`, `block/file`, `block/button`, `block/embed`, `block/web-embed`, `block/nostr`, `block/table`, `block/table-row`, `block/table-column` and `block/query`. Each one extends [`block/base`](../block/base.md), is closed, and has a `type` literal and typed attributes. <!-- id:85wzIKeC -->
- [`block/core`](../block/core.md) is the **core union** of those fifteen. It is strict and rejects any other block. <!-- id:Tp6vmRo8 -->
- `block` is the **open** block: `id`, `type` and arbitrary fields (through [`any`](../any.md)). It is the forward-compatible wire type. A block type this client has no schema for, future or third-party, is still a valid Block, so a document is never rejected because of it. Use `block` only as the fallback for unknown types. A custom block type of your own uses extension and a union, as shown below. <!-- id:idnijeex -->

### Adding a block type <!-- id:YUxiFSMb -->

To add a block type, do what the core blocks do. **Extend `block/base`**, then put your block in a **union** with the core. No new machinery is needed: <!-- id:moIAnCWY -->

```json <!-- id:TQDZHz8Q -->
// example/app-block: the core, PLUS this app's custom Poll block
{ "anyOf": [ { "type": "hm://z6MkmZUb…/block/core" },
             { "type": "hm://z6MkmZUb…/example/poll-block" } ] }
```

See [`example/poll-block`](../example/poll-block.md), a custom block that extends the same base, and [`example/app-block`](../example/app-block.md). That union is **strict for its app**. It accepts core blocks and Polls and rejects any block type it does not know. The wire type `block` stays open. <!-- id:uKNf26fA -->

### Change is generic over its block type <!-- id:lMDDR7Ax -->

An app can also make Change itself strict over its block set. `change` is a [generic](./generic.md) **`Change<Block>`**. The `Block` parameter passes through `change`, `change/body`, `change/op` and [`change/op/replace-block`](../change/op/replace-block.md). Each level passes it down with `args`, and it defaults to the open `block`. An app instantiates it: [`example/myapp-change`](../example/myapp-change.md) is `Change<example/app-block>`. A `ReplaceBlock` op that carries a block type the app does not know is then rejected four levels deep, at `$.body.ops[0].block`. The default Change still accepts any block. This uses the language's generics (`params`, `var` and `args`), described in [the schema language](./schema-language.md). <!-- id:-HAjdTZA -->

## CBOR value shapes <!-- id:IMRnqrVW -->

The wire types map onto [primitive](./primitive.md) schemas, wrapped in aliases with plain names: <!-- id:LTD8_m45 -->

<!-- id:vu31Ab-i -->
| Hypermedia <!-- col:qw20V0RJ --> | CBOR <!-- col:sFcNjdqi --> | schema <!-- col:sw0Ibvi3 --> <!-- id:G6__5qUK --> |
| --- | --- | --- |
| `principal`, `signature` | byte string | `bytes` <!-- id:WvSCivUk --> |
| `cid` | CBOR tag-42 link | `link` <!-- id:aAp0ivQG --> |
| `timestamp` | int64 (Unix ms) | `integer` <!-- id:_oHdoW-v --> |

`validate.mjs` checks every one of these schemas. It checks that each is a well-formed schema. It also validates real blob-shaped data against them: a Ref, a Capability, a Change with ops, the union, and metadata. Negative cases cover wrong `type` tags, missing required fields and unknown keys. <!-- id:jy52yYgY -->

## Seed API read models <!-- id:dVV5nKIm -->

The `rpc/type/*` schemas type the **derived data the [Seed daemon](../apps/daemon.md) computes for clients**. These are the read models the apps consume, and they are not signed network data. They are: <!-- id:jteK8i91 -->
  - [`rpc/type/resource`](../rpc/type/resource.md): the union of every state a fetched resource can be in (document, comment, redirect, not-found, tombstone, error). <!-- id:IQzsTo_3 -->
  - [`rpc/type/document`](../rpc/type/document.md) and [`rpc/type/comment`](../rpc/type/comment.md): the API payload forms, with resolved versions, authors and timestamps. <!-- id:GD3JtXKG -->
  - `rpc/type/citation`, `rpc/type/interaction-summary`, `rpc/type/search-results`, `rpc/type/site-member`, `rpc/type/contact-record` and `rpc/type/discovery-status`. <!-- id:3Y-Cjojh -->
  - [`rpc/type/id`](../rpc/type/id.md): the parsed form of an [`hm://` identifier](../protocol/urls.md), which the others build on. <!-- id:bv2sxXXW -->

The same schemas describe what is signed on the wire and what the [Seed API](../build/web-api.md) serves back. See [Seed API schemas](../rpc.md) for every read method. <!-- id:w1-4ceAw -->

# See also <!-- id:sE3O9dpp -->

- [Blobs](../protocol/blobs.md): signed blobs, envelopes and CIDs as protocol concepts. <!-- id:URKQdsqZ -->
- [Documents](../protocol/documents.md): how Changes and Refs become a document. <!-- id:zVN9-JSN -->
- [Blocks](../protocol/blocks.md): the block tree, annotations and embeds. <!-- id:Ow8Jx5UE -->
- [The schema language](./schema-language.md): extension, unions and generics. <!-- id:mTmegwSB -->
- [Encoding](./encoding.md): canonical DAG-CBOR and the dag-json form. <!-- id:3Cw2Ybeg -->
- [Seed API schemas](../rpc.md): the read methods these read models come from. <!-- id:5ZTRfjZB -->
