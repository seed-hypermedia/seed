# Glossary

**Onyx** — the self-describing type system defined in this directory.

**Kind** — one of the nine value types in the data model: `null`, `boolean`,
`integer`, `float`, `string`, `bytes`, `list`, `map`, `link`. A value is
exactly one kind. ([data-model.md](./data-model.md))

**Schema** — a value of kind `map` that constrains other values, written with
the ten-key vocabulary (eight structural keys plus `name`/`description`
metadata). Every schema is itself typed by the meta-schema, and
is one of the meta-schema's six variants.

**Meta-schema** — [`onyx-schema.json`](./onyx-schema.json): the schema that describes what
a schema is. A **discriminated union** of six variants; a valid instance of
itself, and the system's axiom — the one block whose type is known out of band.

**Discriminated union** — a type that is "one of" a fixed set of variant shapes,
told apart by a discriminant. In Onyx the discriminant is the `type` tag (plus
"has `anyOf`" / "bare `ref`"). Expressed with `anyOf`. ([schema-language.md](./schema-language.md))

**Variant** — one of the six member schemas of the meta-schema union:
`onyx-map-schema`, `onyx-list-schema`, `onyx-scalar-schema`, `onyx-link-schema`, `onyx-include-schema`,
`onyx-union-schema`. Each is a closed map.

**`anyOf`** — the union keyword: a list of schemas; a value is valid if it
matches any of them. Onyx's one composite construct.

**Primitive** — one of the standard-library schemas `onyx-<kind>.json`, each
exactly `{ "type": <kind> }` (e.g. `onyx-string`, `onyx-boolean`). The canonical,
content-addressed block for a kind; reference it (`{ "ref": "onyx-string.json" }`)
instead of inlining a type. An *instance* of the meta-schema — not to be confused
with a **variant**, which is a *shape* the meta-schema is a union of.
([data-model.md](./data-model.md))

**Closed map** — a `map` schema with `properties` and no `values`: keys outside
`properties` are rejected. The default for structs; what lets the meta-schema
reject malformed schemas. Add `values` to make a map open.

**Self-description** — the property that the meta-schema is a valid instance of
itself: `onyx-schema.json` matches its own `union` variant, whose `anyOf` items match
its `include` variant, whose targets match the other variants.
([schema-language.md](./schema-language.md))

**Include** — a bare reference `{ "ref": "hm://…" }` (no `type`, no refinements).
Becomes exactly the referenced schema. ([references.md](./references.md))

**Extension** — a reference node that *also* carries refinements
(`{ "ref": parent, "properties": {…}, "required": […] }`). A subtype: the
parent's fields plus the new ones, `required` unioned, closedness preserved. No
`extends` keyword — the presence of refinements is what distinguishes it from a
bare include. Example: [`example-employee.json`](./example-employee.json) extends
[`example-person.json`](./example-person.json).
([schema-language.md](./schema-language.md))

**Link** — a value of kind `link`: a **CID** pointing to a separate block. A
*typed link* (`{ "type":"link", "ref":"x.json" }`) records the expected type of
the target, checked lazily.

**CID** — Content IDentifier: a self-describing hash that names a block by its
content. The canonical form of a reference.

**IPLD** — InterPlanetary Linked Data: the data model (the nine kinds) Onyx
adopts. Onyx is a schema layer over it.

**DAG-CBOR** — the canonical binary encoding of Onyx blocks on IPFS: a
deterministic CBOR profile with native CID links.

**dag-json** — the JSON projection of the same data model, used as the
human-editable form in this repo. Renders links as `{"/":"…"}` and bytes as
`{"/":{"bytes":"…"}}`.

**Envelope** — the reserved-`/`-key JSON spelling of a link or bytes in
dag-json. A spelling of a distinct kind, **not** a real map.
([encoding.md](./encoding.md))

**`hm://` URL** — a **name reference**: how one schema points at another
(`hm://hyper.media/string`). A name is independent of content, so — unlike a CID
— names can form cycles, which is what makes recursion expressible. Local
filenames are the dev alias (`onyx-string.json` ⇄ `hm://hyper.media/string`).

**Authority** — a public key that owns and signs everything under its name. A
domain like `hyper.media` resolves to one. Schemas reference each other across
authorities: `hm://hyper.media/*` is the base type system (`onyx-*`),
`hm://seed.hyper.media/*` the Hypermedia Network blob schemas (`hypermedia-*`,
see [hypermedia.md](./hypermedia.md)), and `hm://example.com/*` the examples.

**Fixpoint problem** — the impossibility of baking a block's own CID into its
own content (a hash preimage), which also means a *cycle* of CIDs has no
encoding order. The reason references are **names**, not hashes.
([references.md](./references.md))

**Canonical encoding** — DAG-CBOR's single, deterministic byte form for any
value (sorted keys, shortest integers, …). Makes CIDs stable; makes JSON key
order and whitespace cosmetic.

**Struct** — informal term for a `map` constrained by `properties` (fixed named
fields), as opposed to an open map constrained by `values`. Not a separate kind.
