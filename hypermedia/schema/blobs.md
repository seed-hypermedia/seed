---
name: Network Blobs
summary: Hypermedia Schemas describe the six signed blob types of the network and the block model, and this page shows how to add a signed blob type or a block type of your own.
---
The Hypermedia Network stores its data as [blobs](../protocol/blobs.md): pieces of data encoded as [DAG-CBOR](./dag-cbor.md), stored in IPFS and named by the hash of their bytes. Six blob types are signed: [Change](../change.md), [Ref](../ref.md), [Profile](../profile.md), [Comment](../comment.md), [Capability](../capability.md) and [Contact](../contact.md). This page shows how [Hypermedia Schemas](../schema.md) describe them.

The six types belong together, because each one starts with the same four fields, the [signed blob envelope](../blob.md). Their schemas describe real network data and use only the features of the [schema language](./schema-language.md). They are named under the library's [authority](../authority.md), `hm://hyper.media`. The blob schemas sit at the root (`change`, `ref`, …), and the block model sits under `block/`. <!-- id:mIEsrB_H -->

# The shared envelope <!-- id:5NuFY-Ul -->

Every signed blob includes a base envelope, [Signed blob](../blob.md). That page has the signing rule. [Blobs](../protocol/blobs.md) explains the envelope as a protocol idea. Its fields: <!-- id:iAwaugHT -->

<!-- id:fmRGB5ga -->
| field <!-- col:QDXqnDiH --> | type <!-- col:Wdc_fgoB --> | meaning <!-- col:FVItG8md --> <!-- id:l8an2_DE --> |
| --- | --- | --- |
| `type` | string | the tag that says which blob type this is ("Change", "Ref", …) <!-- id:WLcTiayY --> |
| `signer` | `principal` (bytes) | the signer's public key <!-- id:8zO6tjGh --> |
| `sig` | `signature` (bytes) | the signature over the blob <!-- id:lD2RIqxm --> |
| `ts` | `timestamp` (integer) | the time, in Unix milliseconds <!-- id:nFpKKNpd --> |

Each of the six types [extends](./extension.md) the envelope. It inherits those four fields and pins `type` to a [literal](./literal-schema.md): <!-- id:zUkl9LQZ -->
  - `change`: one change to a [document](../protocol/documents.md). Changes are only ever added. Each one names the changes it follows in `deps`. It carries a [`change/body`](../change/body.md) of ops. <!-- id:XNtWFQFG -->
  - `ref`: a signed pointer from a [space](../protocol/spaces.md) and path to the newest Changes of a document. <!-- id:z0t8cH-b -->
  - `profile`: the name, avatar and description of an [account](../protocol/identity.md), or an alias. <!-- id:kuRmAvLb -->
  - `comment`: a [comment](../protocol/comments.md) in a thread. Its body is a tree of [`block/comment`](../block/comment.md) blocks. <!-- id:4B_lboNh -->
  - `capability`: a grant of a [`role`](../role.md) (WRITER or AGENT) to a key. <!-- id:04geSQaa -->
  - `contact`: one account's named reference to another account. <!-- id:A4ma4Edr -->

Open `change` in the [Schema view](./workflows.md#AMFjgZzp). It shows `signer`, `sig` and `ts` as **inherited** and the rest as **added**. The **Dependents** list of `blob` is exactly these six types. <!-- id:S58y-fEh -->

# Define your own signed blob type <!-- id:m8JR3RPQ -->

The six built-in types do not own the envelope. Any schema that extends [Signed blob](../blob.md) and pins a `type` tag is a signed blob type that the app can create.

1. In the schema editor, set the root type to **Signed blob**.
2. Enter the type tag, for example `Vote`.
3. Add your fields.
4. Publish the type as a schema-definition page.

The page's **Create** button opens the signing form. You fill in only your own fields. When you sign, the app adds `signer`, `ts` and `sig` with the key of the selected account. It signs the way the [daemon](../software/daemon.md) checks: it signs the canonical CBOR with the signature field set to zeros. The result is a blob on the network that anyone can verify. The built-in indexer ignores its `type`. Any app that resolves your schema can trust the blob and show it. [Typed blob workflows](./blob-workflows.md) gives the steps in the app, the [CLI](../build/cli.md) and through an [agent](../agent.md). <!-- id:bcuDPBiZ -->

# The blob union <!-- id:TePpgQkJ -->

[`blob/any`](../blob/any.md) is the [discriminated union](./discriminated-union.md) of all six types. The `type` tag tells them apart. So you can check a value against "any Hypermedia blob" as one type. <!-- id:HYLU7eY7 -->

# Nested structure <!-- id:dM0xRByE -->

The body of a Change is a list of [ops](../change/op.md). The op schema is itself a union of SetAttributes, MoveBlocks, ReplaceBlock, DeleteBlocks and SetKey. Content is described by [`block`](../block.md) and [`annotation`](../block/annotation.md). Both are **open [structs](../struct.md)**: known fields plus any extra inline attributes. Document [metadata](../metadata.md) is also an open struct, with known keys (`name`, `summary`, `icon`, `cover`, `layout`, …) plus extras. <!-- id:ahKth012 -->

# Block types: a strict core anyone can extend <!-- id:5qbaLYVx -->

Document content is made of [blocks](../protocol/blocks.md). The block model has two needs that pull in opposite directions:

- Programs need **strict, exact types**. Then they can look at `block.type` and hand each block to code that knows its shape.
- Documents need to be **open**. A block type from a newer program must not make an older program reject the whole document.

One check cannot be both strict and open. If unknown blocks are allowed, a broken Paragraph also passes, because it looks like an unknown block. So the model has layers, and each task picks one: <!-- id:6ghDI01J -->

<!-- id:HpD_T3GL -->
| task <!-- col:SJYqm_FR --> | needs <!-- col:zZHghcu8 --> | use <!-- col:rop7Xg0X --> <!-- id:vpbDuOwM --> |
| --- | --- | --- |
| showing a block | a strict shape per type, and a fallback for unknown types | concrete types + `block` <!-- id:2Rqie-wF --> |
| writing and editing | a strict check | `block/core` <!-- id:ZTfLAdj0 --> |
| [syncing](../protocol/network.md) and storing | never reject an unknown type | `block` <!-- id:23bmRunT --> |
| generating code | the full list of types | `block/core` <!-- id:L8JGoNbX --> |

<!-- id:nNN-eoL8 -->
- The fifteen **concrete blocks** are `block/paragraph`, `block/heading`, `block/code`, `block/math`, `block/image`, `block/video`, `block/file`, `block/button`, `block/embed`, `block/web-embed`, `block/nostr`, `block/table`, `block/table-row`, `block/table-column` and `block/query`. Each one extends [`block/base`](../block/base.md), is closed, and has a `type` literal and typed attributes. <!-- id:85wzIKeC -->
- [`block/core`](../block/core.md) is the **core union** of those fifteen. It is strict and rejects any other block. <!-- id:Tp6vmRo8 -->
- `block` is the **open** block: `id`, `type` and any other fields (through [`any`](../any.md)). It is the type used on the wire. A block type that this program has no schema for is still a valid Block, so no document is rejected because of it. Use `block` only as the fallback for unknown types. For a block type of your own, use an extension and a union, as shown below. <!-- id:idnijeex -->

## Adding a block type <!-- id:YUxiFSMb -->

To add a block type, do what the core blocks do. **Extend `block/base`**, then put your block in a **union** with the core. You need nothing new: <!-- id:moIAnCWY -->

```json <!-- id:TQDZHz8Q -->
// example/app-block: the core, PLUS this app's custom Poll block
{ "anyOf": [ { "type": "hm://hyper.media/block/core" },
             { "type": "hm://hyper.media/example/poll-block" } ] }
```

See [`example/poll-block`](../example/poll-block.md), a custom block that extends the same base, and [`example/app-block`](../example/app-block.md). That union is **strict for its app**. It accepts core blocks and Polls, and it rejects any block type it does not know. The wire type `block` stays open. <!-- id:uKNf26fA -->

## Change is generic over its block type <!-- id:lMDDR7Ax -->

An app can also make Change itself strict about its blocks. `change` is a [generic](./generic.md), **`Change<Block>`**: a type with a blank named `Block`. The parameter passes through `change`, `change/body`, `change/op` and [`change/op/replace-block`](../change/op/replace-block.md). Each level hands it down with `args`. Its default is the open `block`.

An app fills in the blank. [`example/myapp-change`](../example/myapp-change.md) is `Change<example/app-block>`. A `ReplaceBlock` op that carries a block type the app does not know is then rejected four levels deep, at `$.body.ops[0].block`. The default Change still accepts any block. This uses the generics of the language (`params`, `var` and `args`), described in [the schema language](./schema-language.md). <!-- id:-HAjdTZA -->

# CBOR value shapes <!-- id:IMRnqrVW -->

The types used on the wire are [primitive](./primitive.md) schemas with plain names on top: <!-- id:LTD8_m45 -->

<!-- id:vu31Ab-i -->
| Hypermedia <!-- col:qw20V0RJ --> | CBOR <!-- col:sFcNjdqi --> | schema <!-- col:sw0Ibvi3 --> <!-- id:G6__5qUK --> |
| --- | --- | --- |
| [`principal`](../principal.md), [`signature`](../signature.md) | byte string | `bytes` <!-- id:WvSCivUk --> |
| [`cid`](../cid.md) | CBOR tag-42 link | `link` <!-- id:aAp0ivQG --> |
| [`timestamp`](../timestamp.md) | int64 (Unix ms) | `integer` <!-- id:_oHdoW-v --> |

# See also <!-- id:sE3O9dpp -->

- [Blobs](../protocol/blobs.md): signed blobs, envelopes and CIDs as protocol concepts. <!-- id:URKQdsqZ -->
- [Documents](../protocol/documents.md): how Changes and Refs become a document. <!-- id:zVN9-JSN -->
- [Blocks](../protocol/blocks.md): the block tree, annotations and embeds. <!-- id:Ow8Jx5UE -->
- [The schema language](./schema-language.md): extension, unions and generics. <!-- id:mTmegwSB -->
- [Encoding](./encoding.md): canonical DAG-CBOR and the [dag-json](./dag-json.md) form. <!-- id:3Cw2Ybeg -->
- [The catalogue of types](./types.md): every protocol type, block and operation with one line each.
- [Typed blob workflows](./blob-workflows.md): defining and signing a blob type step by step.
