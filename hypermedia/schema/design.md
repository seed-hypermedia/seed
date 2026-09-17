---
name: Design Rationale
summary: Why Hypermedia Schemas have their shape, with the principles, the decisions taken, the open questions and the non-goals.
---
# Design rationale and open questions <!-- id:h0evtq_b -->

This page explains why Hypermedia Schemas have their shape, and what is still undecided. <!-- id:Ax8_SsL- -->

## Principles <!-- id:V0hRDQGX -->

**Minimal enough to describe itself.** The ten _structural_ keys are the smallest set that can express their own structure. `name` and `description` are optional metadata on top. Every candidate feature has to pass one test: the [meta-schema](../schema.md) must still be a valid instance of itself. [The schema language](./schema-language.md) shows the loop, and `validate.mjs` checks it. [Self-description](./self-description.md) is the design constraint. <!-- id:1YvFIYx6 -->

**Precise.** The meta-schema is a [discriminated union](./discriminated-union.md) of [closed](./closed-map.md) [variants](./variant.md), so it rejects malformed schemas such as `{type:"string", items:{…}}`. A type system whose own type is loose would accept nonsense. Making `schema` a union lets it reject that. <!-- id:W4Lj9Nfw -->

**Name kinds, don't define them.** The codec defines what a `string` or a `link` is. The schema language only _names_ codec-defined [kinds](./kind.md) so schemas can constrain values to them. That is why `link` and `bytes` could join with no structural change: they are two more literals in the same union as `string`. <!-- id:trZZS__7 -->

**Representation is separate from kind.** A link renders as `{"/":…}` in JSON, but it is not a map and is never modeled as one. Atomic kinds avoid the reserved-key ambiguity of [dag-json](./dag-json.md). Schemas describe what a value _is_, not how it is spelled in one encoding. <!-- id:xqXFLw1S -->

**One human form, one canonical form.** Authors write JSON. Publishing encodes each schema as [DAG-CBOR](./dag-cbor.md) and records its [CID](../cid.md) in `schemas.lock.json`. References inside a schema stay `hm://` names in both forms. The two forms are projections of one graph, and the step between them is mechanical. See [encoding](./encoding.md). <!-- id:qUSAFSHU -->

## Decisions taken <!-- id:wrBZYU6X -->

- **`integer` / `float` split.** DAG-CBOR encodes them differently, and merging them loses round-trip fidelity. They stay distinct even though JSON has one number type. See [the data model](./data-model.md). <!-- id:7wmzNybN -->
- **`map`, not `object`.** The data-model kind is `map`. A struct is a map constrained by `properties`. There is no separate object or struct kind. <!-- id:WqI0lbQ1 -->
- **Typed links via `target`.** `type:"link"` plus `target` gives the expected type of what the link points at. Every reference-valued leaf shares that one key: a string field with `format: hm-url` or `ipfs-url` carries the same `target`. Links get no vocabulary of their own. Target checking has to be lazy. See [references](./references.md) and [link-schema](./link-schema.md). <!-- id:WXk2ymW4 -->
- **References are names (`hm://` URLs), not CIDs.** A CID cycle has no encoding order. Recursion, including _mutual_ recursion (`example/folder` and `example/file` point at each other), can only be expressed with names. Names resolve through a signing [authority](../authority.md). CIDs pin immutable versions. This replaced an earlier self-sentinel idea. See [references](./references.md) and [URLs](../protocol/urls.md). <!-- id:l1_v0PJ1 -->
- **`type` is a URL, and it is the only naming key.** `type: "hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/map"` makes the kind clickable and self-explanatory. Each [primitive](./primitive.md), such as `map`, is a self-grounding axiom whose `type` names itself. The same key names another schema when the node includes or extends one, so naming a kind and naming a type are one act. The validator still reads the kind locally off the URL, so the discriminated union stays local and strict. The older `ref` key is retired. <!-- id:UgN0v7lk -->
- **Extension by refinement.** `{ type: parent, …refinements }` [extends](./extension.md) the parent as a subtype: properties merge, `required` unions, and closedness is kept. A bare `{ type: parent }` is a pure [include](./include-schema.md). The rule is uniform: `type` names, and any other key refines, for structural and leaf schemas alike. So there is no `extends` keyword and no separate spelling for a leaf that narrows its kind. Example: `example/employee` extends `example/person`. See [the schema language](./schema-language.md). <!-- id:VnxVNOdF -->
- **`anyOf` unions.** [`anyOf`](./anyof.md) was added so `schema` can be a discriminated union. It is the one composite construct, and it stays self-describing: `anyOf` is a list of schemas, expressible with the existing vocabulary, and the meta-schema validates as its own `union` variant. See [the schema language](./schema-language.md). <!-- id:KShLNAZM -->
- **Literals instead of `enum`.** A value is a schema of itself: `"Change"` accepts exactly `"Change"`. A fixed set of choices is a union of [literals](./literal-schema.md), `{anyOf: ["draft", "published"]}`. This replaced an `enum` list on scalar schemas. It removed a keyword, let every choice carry its own `description`, and made a pinned tag read plainly (`type: {value: "Change"}`). A literal can only be a string, integer, boolean or null. A map literal would look the same as a schema, and float equality is unreliable. See [the schema language](./schema-language.md). <!-- id:ObA_urq1 -->
- **Closed maps by default.** A map with `properties` and no `values` rejects unknown keys. This settles the closedness question, and it lets the discriminated union reject malformed schemas. Existing schemas and data stay valid because they list their keys. The cost: data with unknown or future fields is rejected unless the schema opts into `values`. <!-- id:NpAVn9EK -->
- **Generic abstraction (`params` / `var` / `args`).** This waited until a real need appeared. The need was `Change<Block>`: an app plugs in its own block set and gets a _strict_ [Change](../change.md) through the whole op stack without copying it. Type variables pass through references (bind at the top, substitute everywhere) and fall back to a default when unbound, so non-generic use does not change. It stays self-describing: `var` is a new meta-schema variant, and `params` and `args` are maps of schemas on the existing variants. See [generics](./generic.md) and [the schema language](./schema-language.md). <!-- id:5Il_ufHU -->

## Open questions <!-- id:Opl0LUTS -->

**Value constraints beyond kind.** _Since added._ `minLength`/`maxLength`, `pattern`, `minimum`/`maximum` and `minItems`/`maxItems` came from the "Seed Blob Schema v1" dialect. They now narrow the values a leaf accepts. See the value-constraints section of [the schema language](./schema-language.md). The meta-schema must be able to describe each one about itself. Each is cheap, but they add up, so the bar for more (string formats and so on) stays high: add one only for a real need. <!-- id:p37A7OQc -->

**Optional vs nullable.** A missing key and a key set to `null` are different. Today `required` handles presence, and there is no `nullable`. This should be made explicit before data conventions settle. <!-- id:kwN7C5DC -->

**Bytes constraints.** Bytes are opaque. A future `maxBytes`, or a codec or media type tag, might matter for large or typed binary data. It is left out until needed. <!-- id:O9a9U6oJ -->

**Bundling recursive groups.** _Past question._ The earlier design used a self-sentinel for direct self-reference and sketched "bundle into one block" for mutually recursive groups, without a bundle format. Named references replaced both: `example/folder` and `example/file` recurse through `hm://` names with no bundle. See [references](./references.md). <!-- id:caw2phJs -->

## Non-goals <!-- id:QsrBEUi9 -->

- Re-implementing JSON Schema. The language is intentionally tiny, and breadth is a non-goal. <!-- id:Mcymn3Dx -->
- A query or transformation language. It types data and nothing more. <!-- id:i4B6KiPY -->
- Hiding [IPLD](./ipld.md). Links and content addressing stay visible on purpose. <!-- id:ssdyUSWm -->

# See also

- [Why Hypermedia Schemas](./why.md): the problem the design answers.
- [The schema language](./schema-language.md): every key these decisions produced.
- [The data model](./data-model.md): the nine kinds.
- [References and naming](./references.md): names, CIDs and the fixpoint problem.
- [Encoding](./encoding.md): DAG-CBOR and the canonical form.
- [Blobs](../protocol/blobs.md): content addressing on the Hypermedia Network.
