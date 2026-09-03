---
name: References & Naming
summary: Include vs link, the hm:// naming layer, and why names — not content hashes — make recursive schemas possible.
---
# References: include, link, and the self-reference fixpoint <!-- id:5IJDwtlR -->

Onyx has **two** ways one schema can point at another. They look similar in the human form but mean different things, and the distinction becomes load-bearing once everything is content-addressed. <!-- id:X8rzkWzP -->

## Two kinds of reference <!-- id:JOeoh-SP -->

### Include — `ref` alone <!-- id:a_wnChSK -->

```json <!-- id:vnLDG4nN -->
{ "ref": "example-address" }
```

An **include** substitutes the referenced schema in place. In `example-person`, `home` is `{ "ref": "example-address" }`: a person's `home` value is an address, stored **inline** in the person's own block. Includes are an author-time convenience for composing schemas — like `#include` or importing a type. They say nothing about _where the data lives_; the composed value is right there. <!-- id:P5Vw9KYe -->

### Link — `type:"link"` (optionally with `ref`) <!-- id:BHFi5HjZ -->

```json <!-- id:eJIRZitT -->
{ "type": "link", "ref": "example-person" }
```

A **link** types a value that is a **CID** — a pointer to a _separate_ block. In `example-document`, `author` is a typed link to `example-person`: the document block does not contain the person; it contains a hash naming a different block that does. The optional `ref` records the _expected type of the target_ (a "typed link", like IPLD's `&Person`). <!-- id:s1SSoVeN -->

The contrast in one sentence: **include embeds a shape; link points across blocks.** `person.home` carries an address with it; `document.author` points at a person stored elsewhere. <!-- id:UnPOGtlL -->

Target-type checking on a typed link is necessarily **lazy**: the validator cannot confirm the target matches `example-person` without fetching that block. So it verifies the link is well-formed now and defers the target check to resolution time. The reference validator does exactly this. <!-- id:LqRoXxvp -->

## The filename → CID transform <!-- id:f5ZpgAnC -->

In this repo, references are **file names** because humans edit files. When schemas are published to IPFS, a build step: <!-- id:XDQnu6gS -->
  1. encodes each schema to DAG-CBOR (see [encoding](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/encoding)), <!-- id:yi-3JoZG -->
  2. computes its CID, <!-- id:xfljZeXh -->
  3. rewrites every `ref` that named that file into the file's CID. <!-- id:GF9F_NmT -->

`{ "ref": "example-address" }` becomes `{ "ref": <cid-of-address-block> }`. Same graph, resolved by content hash instead of by path. For an **acyclic** set of schemas this is a clean bottom-up pass: encode the leaves, get their CIDs, then their parents, and so on to the root. <!-- id:s9WK8Gv8 -->

## The beautifully meta part — and its fixpoint <!-- id:NqDWNSWI -->

Here is the twist that makes Onyx fold in on itself. The meta-schema refers back to itself — now through its variants. `onyx-schema` is `{ anyOf: [ …refs to the variants… ] }`, and each variant (e.g. `onyx-map-schema`) contains `{ "ref": "onyx-schema" }`. So `onyx-schema` → variant → `onyx-schema` is a **cycle**, and after the transform some `ref` in that cycle must become the CID _of a block whose bytes are still being determined_. <!-- id:21u8uWpR -->

But a CID is the hash of the block's bytes — and those bytes now have to contain that same CID. **You cannot compute it.** Finding content whose hash appears inside that very content is finding a hash preimage; it is computationally infeasible by design. A block genuinely cannot embed its own CID, and a reference cycle cannot be content-addressed in any order — no block in the cycle can be encoded first. <!-- id:HnmaGrbq -->

This is not a quirk of the meta-schema. **Any self-referential schema hits it.** `example-document` has `previous: { type: link, ref: "example-document" }` — a document links to a previous document of the same type. That `ref` → CID rewrite is the identical fixpoint. And **mutually** recursive schemas (A refs B, B refs A) form a cycle that cannot be content-addressed in any order at all: neither CID can be computed first. <!-- id:jQ2u072L -->

### The way out: reference by _name_, not by hash <!-- id:fVw9uG3N -->

A CID is derived from content, so a cycle of CIDs has no encoding order. A **name** is not — it is a stable identifier independent of the content it points to. So references cannot be CIDs; they must be **names**. Onyx uses `hm://` URLs: <!-- id:VLYzJQfm -->

``` <!-- id:RTAR4FMH -->
hm://hyper.media/string        the string kind, owned by the hyper.media authority
hm://example.com/folder        the example folder schema
hm://example.com/file          the example file schema
```

Now recursion just works. `example-folder` references `hm://example.com/file`, and `example-file` references `hm://example.com/folder` — a **mutual** cycle that no CID scheme could express. Because each side names the other, neither has to be encoded first; the names resolve lazily. (In the schema explorer you can click folder → file → folder in a circle.) <!-- id:FxLxMdnv -->

This is the same split as **IPFS vs IPNS**, or a hash vs a domain name: <!-- id:37_9006m -->

<!-- id:b8lxpwqz -->
| <!-- col:i64Tf63L --> | content ref (CID) <!-- col:QiR19bbP --> | name ref (`hm://` URL) <!-- col:cXmrifvD --> <!-- id:85oBMjqa --> |
| --- | --- | --- |
| identifies | exact immutable bytes | an authority + path <!-- id:-jl6UOTj --> |
| resolves via | the hash itself | the authority's signing key → current content <!-- id:4zSZmgf2 --> |
| cycles | impossible | fine <!-- id:mcDC4EuJ --> |
| use for | pinning an exact version | recursive / owned / evolving types <!-- id:X58GiMnr --> |

An **authority** is a public key. A domain like `hyper.media` resolves to one, and that key signs everything published under it, so `hm://hyper.media/string` is a verifiable, owned name. Schemas reference each other across authorities freely — `example-person` (`hm://example.com/…`) references `hm://hyper.media/string` — and you can still pin any name to an exact CID when you want an immutable snapshot. Names for recursion and identity; CIDs for immutability. <!-- id:nsuDvsJA -->

In the repo, local filenames are the dev alias for these URLs (`onyx-string` ⇄ `hm://hyper.media/string`, `example-file` ⇄ `hm://example.com/file`). Unlike the old "filename → CID at publish" story, the _name persists into deployment_ — that is what keeps the loop clickable and the recursion expressible. <!-- id:Mk1UgX6F -->

### Why the meta-schema is special anyway <!-- id:9gbAh4Ot -->

Names make recursion resolvable, but one conceptual point remains. To type-check _any_ block, you validate it against its schema — another block. To type-check the _meta-schema_, you would validate it against... the meta-schema. There is no more-primitive block underneath to ground it on. <!-- id:7ZfeEAOB -->

So the meta-schema is the system's **axiom**: the one block whose type is known a priori, out of band. Its self-reference is not a link you _resolve_ to discover its type — it is the type system asserting its own consistency. This is the same move as `type` being an instance of `type` in Python, or `Type : Type` in a dependent type theory: the tower of "what types this?" has to bottom out somewhere, and here it bottoms out at the schema that describes schemas. <!-- id:n2cjHc2v -->

Named references are the _mechanism_ that makes the self-reference resolvable; "the meta-schema is the axiom" is the _justification_ for why pointing it at itself is legitimate rather than circular-and-broken. <!-- id:o-jpn49c -->
