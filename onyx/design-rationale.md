# Design rationale & open questions

Why Onyx is shaped the way it is, and what is still undecided.

## Principles

**Minimal enough to describe itself.** The eight *structural* keys are not
arbitrary — they are the smallest set that can express its own structure
(`name` and `description` are optional metadata layered on top). Every candidate
feature is measured against one bar: can the meta-schema still be a valid
instance of itself? ([schema-language.md](./schema-language.md) shows the loop;
[`validate.mjs`](./validate.mjs) checks it.) Self-description is the design
constraint, not a party trick.

**Precise, not permissive.** The meta-schema is a *discriminated union* of six
closed variants, so it rejects malformed schemas (`{type:"string", items:{…}}`)
rather than shrugging at them. A type system whose own type is loose isn't
honest; making `schema` a union is what makes it honest.

**Name kinds, don't define them.** The schema language never defines what a
`string` or a `link` is — the codec does. Onyx only *names* codec-defined kinds
so schemas can constrain to them. This is what let `link` and `bytes` join with
zero structural change: they are two more names in the same enum as `string`.

**Representation is not kind.** A link renders as `{"/":…}` in JSON, but it is
not a map and is never modeled as one. Keeping kinds atomic avoids dag-json's
reserved-key ambiguity and keeps schemas honest about what a value *is* versus
how it happens to be spelled.

**One human form, one canonical form.** Author in JSON with filenames; publish
to DAG-CBOR with CIDs. The two are projections of one graph, and the transform
between them is mechanical.

## Decisions taken

- **`integer` / `float` split.** DAG-CBOR encodes them differently; collapsing
  them loses round-trip fidelity. Kept distinct despite JSON having one number
  type. ([data-model.md](./data-model.md))
- **`map`, not `object`.** The data-model kind is `map`; "struct" is just a map
  constrained by `properties`. No separate object/struct kind.
- **Typed links via `ref`.** `type:"link"` + `ref` reuses an existing keyword
  for "expected target type," rather than adding new vocabulary. Target checking
  is lazy by necessity. ([references.md](./references.md))
- **References are names (`hm://` URLs), not CIDs.** A CID cycle has no encoding
  order, so recursion — including *mutual* recursion
  ([`example-folder`](./example-folder.json) ↔ [`example-file`](./example-file.json))
  — is only expressible with names. Names resolve through a
  signing authority; CIDs are kept for pinning immutable versions. This replaced
  the earlier self-sentinel idea. ([references.md](./references.md))
- **`type` is a kind URL, not a bare tag.** `type: "hm://hyper.media/map"` makes
  the kind clickable and self-explanatory, and each primitive (`onyx-map`) is the
  self-grounding axiom whose `type` names itself. The kind is still read locally
  off the URL, so the discriminated union stays local and strict.
- **Extension by refinement.** `{ ref: parent, …refinements }` extends the
  parent (subtype: merged properties, unioned `required`, preserved closedness);
  a bare `{ ref }` is a pure include. Reuses existing keywords — no `extends`.
  Worked example: [`example-employee`](./example-employee.json) extends
  [`example-person`](./example-person.json). ([schema-language.md](./schema-language.md))
- **`anyOf` unions.** Added so `schema` can be a discriminated union. It is the
  one composite construct, and it stays self-describing: `anyOf` is a list of
  schemas, expressible with the existing vocabulary, and the meta-schema
  validates as its own `union` variant. ([schema-language.md](./schema-language.md))
- **Closed maps by default.** A map with `properties` and no `values` rejects
  unknown keys. This resolves the closedness question *and* is what lets the
  discriminated union actually reject malformed schemas. Existing schemas and
  data stay valid (they list their keys); the tradeoff is that data carrying
  unknown/future fields is rejected unless the schema opts into `values`.
- **Generic abstraction (`params` / `var` / `args`).** Deferred until a real
  need appeared — it did: `Change<Block>`, where an app plugs in its own block
  set and gets a *strict* Change through the whole op stack, without duplicating
  it. Type variables thread through references (bind at the top, substitute
  everywhere) and default when unbound, so non-generic use is unchanged. It stays
  self-describing: `var` is a new meta-schema variant, and `params`/`args` are
  maps-of-schema on the existing variants. ([schema-language.md](./schema-language.md))

## Open questions

**Value constraints beyond kind.** No `minLength`, `min`/`max`, `pattern`,
string formats, etc. Deliberately omitted for now. Each one is vocabulary the
meta-schema must also be able to describe about itself — cheap individually,
but they accrete. Add only with a real need.

**Optional-vs-nullable.** Absence (key not present) and presence-of-`null` are
distinct. Today `required` handles presence and there is no `nullable`. Worth
making explicit before data conventions calcify.

**Bytes constraints.** Bytes are opaque. A future `maxBytes` or a codec/mediatype
tag might matter for large or typed binary; omitted until needed.

**Bundling recursive groups.** The self-sentinel handles direct self-reference;
mutually-recursive tangles are sketched as "bundle into one block"
([references.md](./references.md)) but the bundle format is not specified. Left
until a real mutually-recursive schema set forces the design.

## Non-goals

- Not re-implementing JSON Schema. Onyx is intentionally tiny; breadth is a
  non-goal.
- Not a query or transformation language — it types data, nothing more.
- Not hiding IPLD. Links and content-addressing are surfaced, not abstracted
  away; they are the point.
