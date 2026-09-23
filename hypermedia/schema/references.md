---
name: References & Naming
summary: How one schema points at another by include or by typed link, how schemas are named with hm:// URLs, and why names make recursive schemas possible where content hashes cannot.
---
# References: include, link and the self-reference fixpoint <!-- id:5IJDwtlR -->

The [schema language](./schema-language.md) has **two** ways for one schema to point at another. They look similar in the human form but mean different things, and the difference matters once everything is content-addressed. Both are spelled with `type` and `target`. The retired keywords `ref` and `$type` fail the library's `check.mjs` spelling check. Schemas published before that change spell a reference `ref`, and those still resolve. <!-- id:X8rzkWzP -->

## Two kinds of reference <!-- id:JOeoh-SP -->

### Include: `type` names another schema <!-- id:a_wnChSK -->

```json <!-- id:vnLDG4nN -->
{ "type": "example/address" }
```

An [include](./include-schema.md) substitutes the named schema in place. In [`example/person`](../example/person.md), `home` is `{ "type": "example/address" }`. A person's `home` value is an address, stored **inline** in the person's own block. The same `type` key names a [kind](./kind.md): naming `string` grounds the node, and naming `example/address` includes that schema. Adding any other key turns the include into an [extension](./extension.md). Includes are an author-time convenience for composing schemas, like `#include` or importing a type. They say nothing about where the data lives, because the composed value is right there. <!-- id:P5Vw9KYe -->

### Link: `type: "link"`, optionally with `target` <!-- id:BHFi5HjZ -->

```json <!-- id:eJIRZitT -->
{ "type": "link", "target": "example/person" }
```

A [link](./link-schema.md) types a value that is a [CID](../protocol/blobs.md): a pointer to a separate block. In [`example/document`](../example/document.md), `author` is a typed link to `example/person`. The document block does not contain the person. It contains a hash that names a different block, and that block holds the person. The optional `target` records the expected type of the block it points at. This is a "typed link", like IPLD's `&Person`. `target` is the general key for "what this reference points at". A string field whose `format` is `hm-url` or `ipfs-url` can carry one too, naming the schema the referenced document or object should conform to. For an `hm-url` field the constraint is nominal: a document conforms when its effective attributes schema is the target or a schema whose [extension](./extension.md) chain reaches it, and the editor's search for such a field offers exactly those documents. <!-- id:s1SSoVeN -->

In one sentence: **include embeds a shape, and link points across blocks.** `person.home` carries an address with it. `document.author` points at a person stored elsewhere. <!-- id:UnPOGtlL -->

Target-type checking on a typed link is **lazy**. The validator cannot confirm the target matches `example/person` without fetching that block. So it checks now that the link is well-formed, and it checks the target type at resolution time. The reference validator works this way. <!-- id:LqRoXxvp -->

## Direct references by CID <!-- id:directSchemaCid -->

A schema can include or extend another raw schema blob using `"type": "ipfs://<schema-cid>"`. This pins the referenced schema's exact bytes and needs no document. It works when the dependency graph is acyclic: publish the base schema first, then use its CID in the dependent schema. [The raw Person and Employee example](./encoding.md#rawPersonEmployee) shows this alongside the instance's separate `schema` link. <!-- id:directSchemaCidText -->

## Why recursive references cannot all be CIDs <!-- id:f5ZpgAnC -->

One way to publish content-addressed schemas is to replace every reference with a CID. A build step would: <!-- id:XDQnu6gS -->
  1. encode each schema to DAG-CBOR (see [encoding](./encoding.md)), <!-- id:yi-3JoZG -->
  2. compute its CID, <!-- id:xfljZeXh -->
  3. rewrite every reference to that schema into its CID. <!-- id:GF9F_NmT -->

`{ "type": "example/address" }` would become `{ "type": "ipfs://<cid-of-address-block>" }`. The graph stays the same, but it resolves by content hash instead of by name. For an **acyclic** set of schemas this is a clean bottom-up pass: encode the leaves, get their CIDs, then encode their parents, and so on up to the root. The bundled Hypermedia Schemas library does not rewrite all references this way, because it fails on cycles. <!-- id:s9WK8Gv8 -->

## The meta-schema's fixpoint <!-- id:NqDWNSWI -->

The [meta-schema](../schema.md) refers back to itself through its variants. `schema` is `{ anyOf: [ …the variants, each named… ] }`, and each [variant](./variant.md), such as `schema/map-schema`, contains `{ "type": "schema" }`. So `schema` to variant to `schema` is a **cycle**. After a CID rewrite, some reference in that cycle would have to hold the CID of a block whose bytes are not yet known. <!-- id:21u8uWpR -->

A CID is the hash of a block's bytes, and those bytes would now have to contain that same CID. **You cannot compute it.** Finding content whose hash appears inside that content means finding a hash preimage, which is computationally infeasible by design. A block cannot embed its own CID. A reference cycle cannot be content-addressed in any order, because no block in the cycle can be encoded first. This is the [fixpoint problem](./fixpoint-problem.md). <!-- id:HnmaGrbq -->

**Any self-referential schema hits it**, not only the meta-schema. `example/document` has `previous: { type: link, target: "example/document" }`: a document links to a previous document of the same type. Rewriting that reference to a CID is the same fixpoint. **Mutually** recursive schemas, where A references B and B references A, form a cycle that cannot be content-addressed in any order: neither CID can be computed first. <!-- id:jQ2u072L -->

### The solution: reference by name <!-- id:fVw9uG3N -->

A CID is derived from content, so a cycle of CIDs has no encoding order. A **name** is a stable identifier that does not depend on the content it points to. So references are **names**, and the schema language uses [`hm://` URLs](../protocol/urls.md). A schema's name is its path inside the `hypermedia/` folder without `.schema.json` (`string`, `block/image`, `example/person`). The library's [authority](../authority.md) is written as the domain `hyper.media`, so the name `example/folder` is the URL `hm://hyper.media/example/folder`. Its document publishes at the same path in the docs space. References in the schema files are these full URLs: <!-- id:VLYzJQfm -->

``` <!-- id:RTAR4FMH -->
hm://hyper.media/string          the string kind
hm://hyper.media/example/folder  the example folder schema
hm://hyper.media/example/file    the example file schema
```

With names, recursion works. [`example/folder`](../example/folder.md) references `…/example/file`, and [`example/file`](../example/file.md) references `…/example/folder`. That is a **mutual** cycle that no CID scheme can express. Each side names the other, so neither has to be encoded first, and the names resolve lazily. In the schema explorer you can click from folder to file to folder in a circle. <!-- id:FxLxMdnv -->

This is the same split as IPFS and IPNS, or a hash and a domain name: <!-- id:37_9006m -->

<!-- id:b8lxpwqz -->
| <!-- col:i64Tf63L --> | content ref (CID) <!-- col:QiR19bbP --> | name ref (`hm://` URL) <!-- col:cXmrifvD --> <!-- id:85oBMjqa --> |
| --- | --- | --- |
| identifies | exact immutable bytes | an authority + path <!-- id:-jl6UOTj --> |
| resolves via | the hash itself | the authority's signing key → current content <!-- id:4zSZmgf2 --> |
| cycles | impossible | fine <!-- id:mcDC4EuJ --> |
| use for | pinning an exact version | recursive / owned / evolving types <!-- id:X58GiMnr --> |

An authority is a public key, and that key signs everything published under it. `hm://hyper.media/string` names its authority by domain. `hyper.media` is a name the [SDK](../build/sdk.md) and the docs sync understand. The network does not resolve domains in `hm://` URLs yet, and support is planned. Until then the app resolves `hm://hyper.media/…` to its bundled library only. A reference to any other authority, such as `hm://<account>/person`, names a document of that [account](../protocol/identity.md) and is fetched. Schemas can reference each other across authorities. You can still pin any name to an exact CID when you want an immutable snapshot. Use names for recursion and identity, and CIDs for immutability. <!-- id:nsuDvsJA -->

The publish step keeps references as names, `hyper.media` included. `publish.mjs` encodes each schema to canonical DAG-CBOR and records its CID in `schemas.lock.json`, a separate index from `hm://` URL to CID. Because references stay names, a schema's CID depends only on its own bytes, and it is the same wherever the library is published. The docs sync publishes the pages into the space of the signing key and swaps `hyper.media` for that key in page links and frontmatter, so published documents carry the resolved key. <!-- id:Mk1UgX6F -->

### Why the meta-schema is special <!-- id:9gbAh4Ot -->

Names make recursion resolvable, but one conceptual point remains. To type-check any block, you validate it against its schema, which is another block. To type-check the meta-schema, you validate it against the meta-schema. There is no more primitive block underneath to ground it. <!-- id:7ZfeEAOB -->

So the meta-schema is the system's **axiom**: the one block whose type is known in advance, out of band. Its self-reference is the type system asserting its own consistency. Nobody resolves it to discover the meta-schema's type. Python makes the same move with `type` as an instance of `type`, and dependent type theory with `Type : Type`. The chain of "what types this?" has to stop somewhere, and here it stops at the schema that describes schemas. This is [self-description](./self-description.md). <!-- id:n2cjHc2v -->

Named references are the mechanism that makes the self-reference resolvable. The meta-schema being the axiom is the reason pointing it at itself is sound. <!-- id:o-jpn49c -->

# See also <!-- id:H4xmnfzR -->

- [The schema language](./schema-language.md): every keyword, including `type`, `target`, `anyOf` and generics. <!-- id:I8pyifxx -->
- [Encoding](./encoding.md): canonical DAG-CBOR, dag-json and the publish step. <!-- id:52vejBku -->
- [Fixpoint problem](./fixpoint-problem.md): the term page for the cycle this page describes. <!-- id:pPSWAtjN -->
- [Self-description](./self-description.md): how the meta-schema validates itself. <!-- id:fZ2xJrB5 -->
- [`hm://` URL](../hm-url.md) and [Authority](../authority.md): the naming terms. <!-- id:No2WqbdD -->
- [URLs](../protocol/urls.md): Hypermedia URLs across the protocol. <!-- id:XWAEJx82 -->
- [Examples](../example.md): the example schemas used on this page. <!-- id:LasmbvtN -->
