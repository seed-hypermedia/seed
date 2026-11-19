---
name: References & Naming
summary: "A schema points at another schema by include or by typed link, and schemas are named with hm:// URLs so that schemas can refer to each other in a loop."
---
A schema can point at another schema in two ways. An **include** copies the other schema's shape into this one. A **link** says the data holds a pointer to a separate piece of data. They look alike when you write them, so this page shows both side by side. It also explains how a schema is named with an [`hm://` URL](../protocol/urls.md), why names let schemas refer to each other in a loop, and how a reference is resolved. The keys themselves are part of the [schema language](./schema-language.md). <!-- id:X8rzkWzP -->

# Two kinds of reference <!-- id:JOeoh-SP -->

## Include: `type` names another schema <!-- id:a_wnChSK -->

```json <!-- id:vnLDG4nN -->
{ "type": "hm://hyper.media/example/address" }
```

An [include](./include-schema.md) puts the named schema in this place. In [`example/person`](../example/person.md), the field `home` is an include of `example/address`. So a person's `home` value is an address, stored **inline**, inside the person's own data.

The same `type` key also names a [kind](./kind.md). Naming `string` grounds the node. Naming `example/address` includes that schema. Adding `properties`, `values`, `items` or `target` turns the include into an [extension](./extension.md).

An include is a way to build one schema from others, like importing a type in a program. It says nothing about where the data lives, because the included value is right there. <!-- id:P5Vw9KYe -->

## Link: `type: "link"`, optionally with `target` <!-- id:BHFi5HjZ -->

```json <!-- id:eJIRZitT -->
{ "type": "hm://hyper.media/link", "target": "hm://hyper.media/example/person" }
```

A [link](./link-schema.md) types a value that is a [CID](../cid.md): a pointer to a separate [blob](../protocol/blobs.md), named by the hash of its bytes. In [`example/document`](../example/document.md), `author` is a typed link to `example/person`. The document's data does not contain the person. It contains a hash, and that hash names another blob, which holds the person.

The optional `target` records the type the linked blob should have. This is a "typed link", like `&Person` in [IPLD](./ipld.md).

`target` is the general key for "what this reference points at". A string field whose `format` is `hm-url` or `ipfs-url` can carry one too. There it names the schema that the referenced [document](../protocol/documents.md) or object should match.

For an `hm-url` field the rule goes by name. A document matches when its effective attributes schema is the target, or a schema that extends the target through one or more [extensions](./extension.md). [Typed documents](./typed-documents.md) defines the effective attributes schema. The editor's search for such a field lists those documents first. Other documents follow, marked as a different type. <!-- id:s1SSoVeN -->

In one sentence: **an include embeds a shape, and a link points at another blob.** `person.home` carries an address with it. `document.author` points at a person stored somewhere else. <!-- id:UnPOGtlL -->

The check of a typed link's target is **lazy**. The validator cannot know that the target matches `example/person` without fetching that blob. So it checks at once that the link is well formed. The target's type can only be checked when something follows the link. <!-- id:LqRoXxvp -->

# Direct references by CID <!-- id:directSchemaCid -->

A schema can include or extend a raw schema blob with `"type": "ipfs://<schema-cid>"`. This pins the exact bytes of the other schema and needs no document. It works when no schema in the chain refers back to an earlier one. Publish the base schema first, then use its CID in the schema that depends on it. [The raw Person and Employee example](./typing-a-blob.md#rawPersonEmployee) shows this, next to the separate `schema` link that an instance carries. <!-- id:directSchemaCidText -->

# Why recursive references cannot all be CIDs <!-- id:f5ZpgAnC -->

One way to publish schemas is to replace every reference with a CID. A build step would: <!-- id:XDQnu6gS -->
  1. encode each schema to [DAG-CBOR](./dag-cbor.md) (see [encoding](./encoding.md)), <!-- id:yi-3JoZG -->
  2. compute its CID, <!-- id:xfljZeXh -->
  3. rewrite every reference to that schema into its CID. <!-- id:GF9F_NmT -->

`{ "type": "example/address" }` would become `{ "type": "ipfs://<cid-of-address-schema>" }`. The graph of schemas stays the same, but each reference resolves by hash and not by name.

This works when no schema refers back to itself. You encode the schemas that depend on nothing, get their CIDs, then encode the schemas that use them, and so on up. The Hypermedia Schemas library does not rewrite all references this way, because the method fails on a loop. <!-- id:s9WK8Gv8 -->

## The meta-schema's fixpoint <!-- id:NqDWNSWI -->

The [meta-schema](../schema.md) refers back to itself through its variants. `schema` is `{ anyOf: [ …the variants, each named… ] }`. Each [variant](./variant.md), such as `schema/map-schema`, contains `{ "type": "schema" }`. So `schema` points at a variant, and the variant points at `schema`. That is a **loop**.

To write A's hash inside B, you must finish A first. To write B's hash inside A, you must finish B first. In a loop, neither can be finished first. <!-- id:21u8uWpR -->

A CID is the hash of a blob's bytes. In a loop, those bytes would have to contain that same CID. **You cannot compute it.** A hash function is built so that nobody can find content that contains its own hash. So a blob cannot hold its own CID, and a loop of references cannot be turned into CIDs in any order. This is the [fixpoint problem](./fixpoint-problem.md). <!-- id:HnmaGrbq -->

**Every schema that refers to itself meets this problem**, not only the meta-schema. `example/document` has `previous: { type: link, target: "example/document" }`: a document links to an earlier document of the same type. Rewriting that reference to a CID is the same problem. The same is true when A refers to B and B refers to A: neither CID can be computed first. <!-- id:jQ2u072L -->

# The solution: reference by name <!-- id:fVw9uG3N -->

A CID comes from content, so a loop of CIDs has no order to encode in. A **name** does not depend on the content it points at. So references are **names**, and the schema language uses [`hm://` URLs](../protocol/urls.md) as names.

The name of a library schema is its path in the library: `string`, `block/image`, `example/person`. The library writes its [authority](../authority.md) as the domain `hyper.media`. So the name `example/folder` is the URL `hm://hyper.media/example/folder`. References inside a schema are these full URLs: <!-- id:VLYzJQfm -->

``` <!-- id:RTAR4FMH -->
hm://hyper.media/string          the string kind
hm://hyper.media/example/folder  the example folder schema
hm://hyper.media/example/file    the example file schema
```

With names, loops work. [`example/folder`](../example/folder.md) refers to `…/example/file`, and [`example/file`](../example/file.md) refers to `…/example/folder`. No scheme of CIDs can express that loop. With names, each side names the other, so neither has to be encoded first. A name is resolved only when something needs it. In the [Schema view](./workflows.md#AMFjgZzp) you can click from folder to file to folder in a circle. <!-- id:FxLxMdnv -->

IPFS and IPNS make the same split, and so do a hash and a domain name: <!-- id:37_9006m -->

<!-- id:b8lxpwqz -->
| <!-- col:i64Tf63L --> | content reference (CID) <!-- col:QiR19bbP --> | name reference (`hm://` URL) <!-- col:cXmrifvD --> <!-- id:85oBMjqa --> |
| --- | --- | --- |
| identifies | exact bytes that never change | an authority and a path <!-- id:-jl6UOTj --> |
| resolves via | the hash itself | the authority's signing key, which leads to the current content <!-- id:4zSZmgf2 --> |
| loops | impossible | fine <!-- id:mcDC4EuJ --> |
| use for | pinning one exact version | types that are recursive, owned, or that change over time <!-- id:X58GiMnr --> |

An authority is a public key, and that key signs everything published under it. A reference such as `hm://<account>/person` names a document of that [account](../protocol/identity.md). Schemas can refer to each other across authorities. You can still pin any name to an exact CID when you want a snapshot that never changes. Use names for loops and for identity. Use CIDs for exact, fixed content. <!-- id:nsuDvsJA -->

References stay names in the encoded schema. So a schema's CID depends only on its own bytes, and it is the same wherever the schema is published. [Encoding](./encoding.md) covers the CID.

## The library's name, `hm://hyper.media`

The library writes its authority as the domain `hyper.media`: `hm://hyper.media/string`. **`hm://hyper.media/…` is a name that the [SDK](../build/sdk.md) and the docs publishing script resolve. The network does not resolve domains in `hm://` URLs.**

The SDK and the apps resolve these names from the copy of the library bundled inside them. Each library type also has a published page. That page lives in the docs [space](../protocol/spaces.md), and its URL carries that space's key. [The library pipeline](./library-pipeline.md) describes how that script swaps the domain for the key in pages and leaves schema blobs unchanged. <!-- id:Mk1UgX6F -->

# How a reference resolves <!-- id:Rb6zmKSF -->

A schema reference has three forms, and each one resolves in its own way: <!-- id:ZVviNKyM -->

<!-- id:uSHoX7eZ -->
| reference <!-- col:JXT6M672 --> | example <!-- col:lj87cEho --> | how it resolves <!-- col:FkwrUKdr --> <!-- id:DxBoBqwn --> |
| --- | --- | --- |
| library URL | `hm://hyper.media/map` | locally, from the registry compiled into the app, with no network <!-- id:_MyC7yOr --> |
| IPFS CID | `ipfs://bafy…` | fetch the blob directly (from the bundle if it is known, otherwise from the [daemon](../software/daemon.md)) <!-- id:0XLNPaVl --> |
| any Hypermedia document URL | `hm://acme/person` | fetch the document, read its `metadata.schemaDefinition`, then fetch that blob <!-- id:a2Tm8pMr --> |

The third form lets anyone add types. A schema published under any account resolves the same way as one from the library. [Typed documents](./typed-documents.md) describes the type page that carries `schemaDefinition`, and the rule for a document's effective schema. <!-- id:abCKIpn0 -->

# Why the meta-schema is special <!-- id:9gbAh4Ot -->

Names make loops resolvable, but one question remains. To check any blob, you check it against its schema, which is another blob. To check the meta-schema, you check it against the meta-schema. No simpler schema sits underneath it. <!-- id:7ZfeEAOB -->

So the meta-schema is the system's **axiom**: the one schema whose type is known in advance and is not looked up. Nobody resolves its self-reference to find out what type it has. Python does the same when it makes `type` an instance of `type`. The question "what types this?" has to stop somewhere, and here it stops at the schema that describes schemas. This is [self-description](./self-description.md). <!-- id:n2cjHc2v -->

Named references are what make the self-reference resolvable. The meta-schema being the axiom is why pointing it at itself is sound. <!-- id:o-jpn49c -->

# See also <!-- id:H4xmnfzR -->

- [The schema language](./schema-language.md): every key, including `type`, `target`, `anyOf` and generics. <!-- id:I8pyifxx -->
- [Encoding](./encoding.md): canonical DAG-CBOR, [dag-json](./dag-json.md) and a schema's CID. <!-- id:52vejBku -->
- [Fixpoint problem](./fixpoint-problem.md): the term page for the loop this page describes. <!-- id:pPSWAtjN -->
- [Self-description](./self-description.md): how the meta-schema checks itself. <!-- id:fZ2xJrB5 -->
- [`hm://` URL](../hm-url.md) (the value type) and [Authority](../authority.md): the naming terms. <!-- id:No2WqbdD -->
- [URLs](../protocol/urls.md): Hypermedia URLs across the protocol. <!-- id:XWAEJx82 -->
- [Examples](../example.md): the example schemas used on this page. <!-- id:LasmbvtN -->
