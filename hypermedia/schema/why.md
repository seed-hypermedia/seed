---
name: Why Schemas
summary: The rationale for Hypermedia Schemas, covering the problem a self-describing type system solves for content-addressed hypermedia, who it serves, the principles and decisions behind the language, and what it does not try to be.
---
This page gives the reasons behind [Hypermedia Schemas](../schema.md): the problem they solve, what they make possible, the principles the language holds to, the decisions that follow from them, and the things the system leaves out on purpose. [The schema language](./schema-language.md) is the reference for the result.

# The problem <!-- id:hdD9n48L -->

On a content-addressed network, a piece of data is a hash and some bytes. The hash proves _which_ bytes you have. It says nothing about _what they mean_. Every reader has to know the shape of the data in advance. <!-- id:jkCV8kpL -->

Without a shared type system, that knowledge lives in code. The shapes of the [signed blobs](../protocol/blobs.md) ([Change](../change.md), [Ref](../ref.md), [Profile](../profile.md), [Comment](../comment.md), [Capability](../capability.md), [Contact](../contact.md)) are written once in the Go [daemon](../software/daemon.md) and again in the TypeScript apps, and a new kind of resource needs a code change on both sides and a release. [Document metadata](../metadata.md) is an untyped bag of keys, so software cannot tell a "person" page from a "product" page. Tool inputs and outputs for [agents](../agent.md) need a schema world of their own, so a tool cannot return a real [document](../protocol/documents.md), and a document cannot be passed to a tool without a hand-written translation layer.

Hypermedia Schemas replace those separate worlds with one type system that lives inside the network it describes. Three design choices make that work.

**Types are data.** A Hypermedia schema is itself a DAG-CBOR block. It uses the same encoding, content addressing, signing and syncing as the data it types. A schema has a [CID](../cid.md). You can pin, fetch and verify it like any other blob. There is no separate registry service to run or trust. <!-- id:DQpYhLZV -->

**Types are documents.** A schema can be published as a normal Hypermedia document, owned by an [account](../protocol/identity.md) and reachable at an [`hm://` URL](../protocol/urls.md). That gives types names, versions, human descriptions, and a place in the same browsable graph as everything else. A document declares what it is by pointing at one of these URLs. References are names, so types can refer to each other in cycles, such as a folder that contains files that live in folders. A pure hash graph cannot express that. See [references and naming](./references.md). <!-- id:o9b8CRI8 -->

**Types are minimal.** There are nine [kinds](./kind.md) of value and nine shapes a schema can take. Every feature has to pass one test: the schema that defines what a schema is must stay a valid instance of itself. That [self-description](./self-description.md) is the design constraint, and it keeps the language small. <!-- id:ejkukc5O -->

# What it makes possible <!-- id:n8_sc-MO -->

- **New resource types without a release.** To add a kind of thing, publish a schema document. Any app that can resolve the URL can validate that kind, render forms for it and generate code for it. The core does not change. <!-- id:Ku-kyWNg -->
- **Typed documents.** A document can say which schema it conforms to, which schema its children must conform to, or which schema it _defines_. The editor shows required fields as rows that are always present and flags data that does not match. See [typed documents](./typed-documents.md). <!-- id:5kYrfz-H -->
- **One schema system for content and for tools.** A tool's contract is an input schema and an output schema. Those are Hypermedia schemas, the same objects that type documents. A tool can emit a real document, and a document can be a tool's typed input, because both sides use the same language. <!-- id:EWBxFyCH -->
- **Generated code.** Every schema becomes a TypeScript type. The app's types come from the published schemas, so there is no second source of truth to drift. <!-- id:du8NMRdv -->
- **Machine-readable meaning for agents.** An agent that lands on an `hm://` document can follow its `attributesSchema` link and learn which fields to expect and what they mean. It reads a tool's contract the same way. Types are found by URL, with no out-of-band convention. <!-- id:wnqV6OF- -->

# Who it serves <!-- id:YPiEjlT9 -->

**Readers** see no change, except that typed pages can render better. A person page can show a person instead of a bag of keys. <!-- id:TAte4XSS -->

**Authors** get guardrails. The attributes form knows which fields a document of this kind needs. It offers the right control for each: a dropdown for a fixed set of choices, a searchable title pill for a document reference, and a file picker for an IPFS reference. It points out what does not match the schema, and it never refuses to save. <!-- id:mIlfg1bz -->

**Developers** get TypeScript types, a browsable linked reference for every schema, schema-driven forms, and a console for calling the API with validated inputs. <!-- id:U77YK0ax -->

**Agents and tools** get contracts they can read and be checked against. Tools and agents can then be hypermedia resources themselves. <!-- id:d4tnck1j -->

# Validation warns and never blocks <!-- id:IYcGoiB1 -->

Validation has two modes. **At rest it is advisory.** A blob is a cryptographic fact, and you will often receive data whose schema you have not fetched, or whose author used a newer version. The app stores it, renders what it can, and shows red warnings that do not block anything. A document with out-of-spec data still saves. **At a boundary it is strict.** The reference validator rejects malformed schemas, the CLI's checks fail, a raw object that does not match its type is refused unless forced, and a tool or API call is checked against its declared contract before it runs. Validation is lenient where data is stored and strict where it is acted on. <!-- id:VaWhKFCl -->

# Principles <!-- id:V0hRDQGX -->

**Minimal enough to describe itself.** The ten _structural_ keys of [the schema language](./schema-language.md) are the smallest set that can express their own structure. `name` and `description` are optional metadata on top, which makes twelve core keys. Every candidate feature has to pass one test: the [meta-schema](../schema.md) must still be a valid instance of itself. Value constraints follow the same rule: the meta-schema must be able to describe each one about itself. Each is cheap, but they add up, so the bar for more stays high. <!-- id:1YvFIYx6 -->

**Precise.** The meta-schema is a [discriminated union](./discriminated-union.md) of [closed](./closed-map.md) [variants](./variant.md), so it rejects malformed schemas such as `{type:"string", items:{…}}`. A type system whose own type is loose would accept nonsense. Making `schema` a union lets it reject that. <!-- id:W4Lj9Nfw -->

**Name kinds, don't define them.** The codec defines what a `string` or a `link` is. The schema language only _names_ codec-defined [kinds](./kind.md) so schemas can constrain values to them. `link` and `bytes` are two more literals in the same union as `string`, with no structure of their own. <!-- id:trZZS__7 -->

**Representation is separate from kind.** A link renders as `{"/":…}` in JSON, but it is not a map and is never modeled as one. Atomic kinds avoid the reserved-key ambiguity of [dag-json](./dag-json.md). Schemas describe what a value _is_, not how it is spelled in one encoding. <!-- id:xqXFLw1S -->

**One human form, one canonical form.** Authors write JSON. Publishing encodes each schema as [DAG-CBOR](./dag-cbor.md) and gives it a [CID](../cid.md). References inside a schema stay `hm://` names in both forms. The two forms are projections of one graph, and the step between them is mechanical. See [encoding](./encoding.md). <!-- id:qUSAFSHU -->

# Decisions <!-- id:wrBZYU6X -->

- **`integer` / `float` split.** DAG-CBOR encodes them differently, and merging them loses round-trip fidelity. They stay distinct even though JSON has one number type. See [the data model](./data-model.md). <!-- id:7wmzNybN -->
- **`map`, not `object`.** The data-model kind is `map`. A struct is a map constrained by `properties`. There is no separate object or struct kind. <!-- id:WqI0lbQ1 -->
- **Typed links via `target`.** `type:"link"` plus `target` gives the expected type of what the link points at. Every reference-valued leaf shares that one key: a string field with `format: hm-url` or `ipfs-url` carries the same `target`. Links get no vocabulary of their own. Target checking has to be lazy. See [references](./references.md) and [link-schema](./link-schema.md). <!-- id:WXk2ymW4 -->
- **References are names (`hm://` URLs), not CIDs.** A CID cycle has no encoding order. Recursion, including _mutual_ recursion (`example/folder` and `example/file` point at each other), can only be expressed with names, with no bundle format for recursive groups. Names resolve through a signing [authority](../authority.md). CIDs pin immutable versions. See [references](./references.md) and [URLs](../protocol/urls.md). <!-- id:l1_v0PJ1 -->
- **`type` is a URL, and it is the only naming key.** `type: "hm://hyper.media/map"` makes the kind clickable and self-explanatory. Each [primitive](./primitive.md), such as `map`, is a self-grounding axiom whose `type` names itself. The same key names another schema when the node includes or extends one, so naming a kind and naming a type are one act. The validator still reads the kind locally off the URL, so the discriminated union stays local and strict. <!-- id:UgN0v7lk -->
- **Extension by refinement.** `{ type: parent, …refinements }` [extends](./extension.md) the parent as a subtype: properties merge, `required` unions, and closedness is kept. A bare `{ type: parent }` is a pure [include](./include-schema.md). The rule is uniform: `type` names, and any other key refines, for structural and leaf schemas alike. So there is no `extends` keyword and no separate spelling for a leaf that narrows its kind. Example: `example/employee` extends `example/person`. <!-- id:VnxVNOdF -->
- **`anyOf` unions.** [`anyOf`](./anyof.md) lets `schema` be a discriminated union. It is the one composite construct, and it stays self-describing: `anyOf` is a list of schemas, expressible with the existing vocabulary, and the meta-schema validates as its own union variant. <!-- id:KShLNAZM -->
- **Literals instead of `enum`.** A value is a schema of itself: `"Change"` accepts exactly `"Change"`. A fixed set of choices is a union of [literals](./literal-schema.md), `{anyOf: ["draft", "published"]}`. There is no `enum` keyword, every choice can carry its own `description`, and a pinned tag reads plainly (`type: {value: "Change"}`). A literal can only be a string, integer, boolean or null. A map literal would look the same as a schema, and float equality is unreliable. <!-- id:ObA_urq1 -->
- **Closed maps by default.** A struct with `properties` and no `values` rejects unknown keys. This lets the discriminated union reject malformed schemas. The cost: data with unknown or future fields is rejected unless the schema opts into `values`. <!-- id:NpAVn9EK -->
- **Generic abstraction (`params` / `var` / `args`).** The need is `Change<Block>`: an app plugs in its own block set and gets a _strict_ [Change](../change.md) through the whole op stack without copying it. Type variables pass through references (bind at the top, substitute everywhere) and fall back to a default when unbound, so non-generic use does not change. It stays self-describing: `var` is a meta-schema variant, and `params` and `args` are maps of schemas on the existing variants. See [generics](./generic.md). <!-- id:5Il_ufHU -->
- **Presence, not nullability.** A missing key and a key set to `null` are different. `required` handles presence, and there is no `nullable` keyword. <!-- id:kwN7C5DC -->
- **Bytes are opaque.** There is no size limit, codec tag or media type constraint on `bytes`. <!-- id:O9a9U6oJ -->

# What Hypermedia Schemas are not <!-- id:h0dABmfh -->

<!-- id:utOrwOxn -->
| It is not <!-- col:DTSldmk2 --> | Because <!-- col:cveLwo3h --> <!-- id:gMG14EHP --> |
| --- | --- |
| a re-implementation of JSON Schema | breadth is a non-goal; the language is intentionally tiny and must stay self-describing <!-- id:INWG0Cxy --> |
| IPLD Schema | Hypermedia schemas are themselves IPLD data and hypermedia documents, and references are names that can recurse <!-- id:AMRqP6pA --> |
| a query or transformation language | it types data, nothing more; queries live in the hypermedia layer <!-- id:MWHaO1Hx --> |
| an abstraction over IPLD | links and content addressing are visible on purpose <!-- id:X7KnF8E7 --> |
| a gate on writing | violations warn; they never block a save <!-- id:BMF06lQT --> |

# See also <!-- id:_1bOSofL -->

- [Hypermedia Schemas](../schema.md): what a schema is, and where each topic lives.
- [The schema language](./schema-language.md): every key these decisions produced. <!-- id:JpeSzRGL -->
- [Typed documents](./typed-documents.md): `attributesSchema`, `childAttributesSchema` and `schemaDefinition`. <!-- id:OWulMFtU -->
- [References and naming](./references.md): why names make recursive types possible. <!-- id:Q9IqdtnW -->
- [The data model](./data-model.md): the nine kinds. <!-- id:ZqCLNrz9 -->
- [Encoding](./encoding.md): DAG-CBOR and the canonical form. <!-- id:lwt8efof -->
- [Blobs](../protocol/blobs.md): the signed data the schemas describe. <!-- id:C9hGMBp- -->
- [Metadata](../metadata.md): the document attributes a schema types. <!-- id:TXBSw0rH -->
