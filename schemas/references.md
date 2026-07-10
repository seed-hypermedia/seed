# References: include, link, and the self-reference fixpoint

Onyx has **two** ways one schema can point at another. They look similar in the
human form but mean different things, and the distinction becomes load-bearing
once everything is content-addressed.

## Two kinds of reference

### Include — `ref` alone

```json
{ "ref": "example-address.json" }
```

An **include** substitutes the referenced schema in place. In
[`example-person.json`](./example-person.json), `home` is `{ "ref": "example-address.json" }`: a
person's `home` value is an address, stored **inline** in the person's own
block. Includes are an author-time convenience for composing schemas — like
`#include` or importing a type. They say nothing about *where the data lives*;
the composed value is right there.

### Link — `type:"link"` (optionally with `ref`)

```json
{ "type": "link", "ref": "example-person.json" }
```

A **link** types a value that is a **CID** — a pointer to a *separate* block.
In [`example-document.json`](./example-document.json), `author` is a typed link to
`example-person.json`: the document block does not contain the person; it contains a
hash naming a different block that does. The optional `ref` records the
*expected type of the target* (a "typed link", like IPLD's `&Person`).

The contrast in one sentence: **include embeds a shape; link points across
blocks.** `person.home` carries an address with it; `document.author` points at
a person stored elsewhere.

Target-type checking on a typed link is necessarily **lazy**: the validator
cannot confirm the target matches `example-person.json` without fetching that block. So
it verifies the link is well-formed now and defers the target check to
resolution time. The reference validator does exactly this.

## The filename → CID transform

In this repo, references are **file names** because humans edit files. When
schemas are published to IPFS, a build step:

1. encodes each schema to DAG-CBOR (see [encoding.md](./encoding.md)),
2. computes its CID,
3. rewrites every `ref` that named that file into the file's CID.

`{ "ref": "example-address.json" }` becomes `{ "ref": <cid-of-address-block> }`. Same
graph, resolved by content hash instead of by path. For an **acyclic** set of
schemas this is a clean bottom-up pass: encode the leaves, get their CIDs, then
their parents, and so on to the root.

## The beautifully meta part — and its fixpoint

Here is the twist that makes Onyx fold in on itself. The meta-schema refers back
to itself — now through its variants. `onyx-schema.json` is `{ anyOf: [ …refs to the
six variants… ] }`, and each variant (e.g. `onyx-map-schema.json`) contains `{ "ref":
"onyx-schema.json" }`. So `onyx-schema.json` → variant → `onyx-schema.json` is a **cycle**, and
after the transform some `ref` in that cycle must become the CID *of a block
whose bytes are still being determined*.

But a CID is the hash of the block's bytes — and those bytes now have to
contain that same CID. **You cannot compute it.** Finding content whose hash
appears inside that very content is finding a hash preimage; it is
computationally infeasible by design. A block genuinely cannot embed its own
CID, and a reference cycle cannot be content-addressed in any order — no block
in the cycle can be encoded first.

This is not a quirk of the meta-schema. **Any self-referential schema hits it.**
[`example-document.json`](./example-document.json) has `previous: { type: link, ref:
"example-document.json" }` — a document links to a previous document of the same type.
That `ref` → CID rewrite is the identical fixpoint. And **mutually** recursive
schemas (A refs B, B refs A) form a cycle that cannot be content-addressed in
any order at all: neither CID can be computed first.

### The way out: reference by *name*, not by hash

A CID is derived from content, so a cycle of CIDs has no encoding order. A
**name** is not — it is a stable identifier independent of the content it points
to. So references cannot be CIDs; they must be **names**. Onyx uses `hm://` URLs:

```
hm://hyper.media/string        the string kind, owned by the hyper.media authority
hm://example.com/folder        the example folder schema
hm://example.com/file          the example file schema
```

Now recursion just works. `example-folder` references `hm://example.com/file`,
and `example-file` references `hm://example.com/folder` — a **mutual** cycle
that no CID scheme could express. Because each side names the other, neither has
to be encoded first; the names resolve lazily.

This is the same split as **IPFS vs IPNS**, or a hash vs a domain name:

| | content ref (CID) | name ref (`hm://` URL) |
| --- | --- | --- |
| identifies | exact immutable bytes | an authority + path |
| resolves via | the hash itself | the authority's signing key → current content |
| cycles | impossible | fine |
| use for | pinning an exact version | recursive / owned / evolving types |

An **authority** is a public key. A domain like `hyper.media` resolves to one,
and that key signs everything published under it, so `hm://hyper.media/string`
is a verifiable, owned name. Schemas reference each other across authorities
freely — `example-person` (`hm://example.com/…`) references
`hm://hyper.media/string` — and you can still pin any name to an exact CID when
you want an immutable snapshot. Names for recursion and identity; CIDs for
immutability.

In the repo, local filenames are the dev alias for these URLs
(`onyx-string.json` ⇄ `hm://hyper.media/string`, `example-file.json` ⇄
`hm://example.com/file`). Unlike the old "filename → CID at publish" story, the
*name persists into deployment* — that is what keeps the loop clickable and the
recursion expressible.

### Why the meta-schema is special anyway

Names make recursion resolvable, but one conceptual point remains. To
type-check *any* block, you validate it against its schema — another block. To
type-check the *meta-schema*, you would validate it against... the meta-schema.
There is no more-primitive block underneath to ground it on.

So the meta-schema is the system's **axiom**: the one block whose type is known
a priori, out of band. Its self-reference is not a link you *resolve* to
discover its type — it is the type system asserting its own consistency. This
is the same move as `type` being an instance of `type` in Python, or `Type :
Type` in a dependent type theory: the tower of "what types this?" has to bottom
out somewhere, and here it bottoms out at the schema that describes schemas.

Named references are the *mechanism* that makes the self-reference resolvable;
"the meta-schema is the axiom" is the *justification* for why pointing it at
itself is legitimate rather than circular-and-broken.
