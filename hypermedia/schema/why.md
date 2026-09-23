---
name: Why Schemas
summary: This page gives the reasons behind Hypermedia Schemas, from the problem they solve and who they serve to the design decisions and what the system leaves out.
---
[Hypermedia Schemas](../schema.md) are a way to say what a piece of data must look like, written as data on the same network. This page gives the reasons behind them. It covers the problem they solve, what they make possible, the principles of the language, the decisions that follow, and what the system leaves out on purpose. [The schema language](./schema-language.md) is the reference for the result.

# The problem <!-- id:hdD9n48L -->

On a content-addressed network, a piece of data is a hash and some bytes. The hash proves _which_ bytes you have. It says nothing about _what they mean_. Every reader has to know the shape of the data before reading it. <!-- id:jkCV8kpL -->

Without a shared type system, that knowledge lives in code. This causes three problems:
  - The shapes of the [signed blobs](../protocol/blobs.md) ([Change](../change.md), [Ref](../ref.md), [Profile](../profile.md), [Comment](../comment.md), [Capability](../capability.md), [Contact](../contact.md)) are written once in the Go [daemon](../software/daemon.md) and again in the TypeScript apps. A new kind of resource needs a code change on both sides and a release.
  - [Document metadata](../metadata.md) is a bag of keys with no types. Software cannot tell a "person" page from a "product" page.
  - Tool inputs and outputs for [agents](../agent.md) need a schema system of their own. So a tool cannot return a real [document](../protocol/documents.md), and a document cannot go into a tool without hand-written code to translate it.

Hypermedia Schemas replace those separate systems with one type system. It lives inside the network it describes. Three design choices make that work.

**Types are data.** A Hypermedia schema is itself a DAG-CBOR blob. It uses the same encoding, content addressing, signing and syncing as the data it types. A schema has a [CID](../cid.md). You can pin it, fetch it and check it like any other blob. There is no separate registry service to run or to trust. <!-- id:DQpYhLZV -->

**Types are documents.** You can publish a schema as a normal Hypermedia document. An [account](../protocol/identity.md) owns it, and it has an [`hm://` URL](../protocol/urls.md). That gives a type a name, versions, a description for people, and a place among all the other pages. A document says what it is by pointing at one of these URLs. References are names, so types can refer to each other in a circle. For example, a folder holds files, and a file lives in a folder. A graph made only of hashes cannot express that. See [references and naming](./references.md). <!-- id:o9b8CRI8 -->

**Types are minimal.** There are nine [kinds](./kind.md) of value and ten map shapes a schema can take. Every feature has to pass one test: the schema that defines what a schema is must still be a valid schema by its own rules. That [self-description](./self-description.md) is the limit on the design, and it keeps the language small. <!-- id:ejkukc5O -->

# What it makes possible <!-- id:n8_sc-MO -->

- **New resource types without a release.** To add a kind of thing, publish a schema document. Any app that can resolve the URL can check that kind, draw forms for it and generate code for it. The core does not change. <!-- id:Ku-kyWNg -->
- **Typed documents.** A document can say which schema it follows, which schema its children follow, or which schema it _defines_. The editor shows required fields as rows that are always present, and it marks data that does not match. See [typed documents](./typed-documents.md). <!-- id:5kYrfz-H -->
- **One schema system for content and for tools.** A tool's contract is an input schema and an output schema. Those are Hypermedia schemas, the same objects that type documents. So a [tool](../tool.md) can return a real document, and a document can be a tool's typed input. Both sides use the same language. <!-- id:EWBxFyCH -->
- **Generated code.** Every schema becomes a TypeScript type. The app's types come from the published schemas. There is no second copy that can fall out of step. <!-- id:du8NMRdv -->
- **Machine-readable meaning for agents.** An agent that lands on an `hm://` document can follow its `attributesSchema` link and learn which fields to expect and what they mean. It reads a tool's contract the same way. An agent finds a type by its URL and needs no other agreement. <!-- id:wnqV6OF- -->

# Who it serves <!-- id:YPiEjlT9 -->

**Readers** see no change, except that typed pages can look better. A person page can show a person, not a list of keys. <!-- id:TAte4XSS -->

**Authors** get help. The attributes form knows which fields a document of this kind needs. It offers the right control for each: a dropdown for a fixed set of choices, a searchable title pill for a document reference, and a file picker for an IPFS reference. It points out what does not match the schema, and it never refuses to save. <!-- id:mIlfg1bz -->

**Developers** get TypeScript types, a linked reference page for every schema, and forms that are built from a schema. <!-- id:U77YK0ax -->

**Agents and tools** get contracts they can read and be checked against. Tools and agents can then be hypermedia resources themselves. <!-- id:d4tnck1j -->

# Validation warns and never blocks <!-- id:IYcGoiB1 -->

Validation means checking data against its schema. It works in two ways. <!-- id:VaWhKFCl -->

**For stored data, it only warns.** A blob is signed and hashed, so it exists whether or not it matches. You often receive data whose schema you have not fetched, or whose author used a newer version. The app stores it, shows what it can, and shows red warnings that do not block anything. A document with data that does not match still saves.

**Where data is acted on, it is strict.** The reference validator rejects a broken schema. The checks of the [CLI](../build/cli.md) fail. A raw object that does not match its type is refused unless you force it. A tool call is checked against its declared contract before it runs.

# Principles <!-- id:V0hRDQGX -->

**Minimal enough to describe itself.** The eleven _structural_ keys of [the schema language](./schema-language.md) are the smallest set that can describe their own structure. `name` and `description` are optional notes on top, which makes thirteen core keys. Every new feature has to pass one test: the [meta-schema](../schema.md), the schema that describes all schemas, must still be valid by its own rules. Value constraints follow the same rule: the meta-schema must be able to describe each one. Each constraint is small, but they add up, so few are added. <!-- id:1YvFIYx6 -->

**Precise.** The meta-schema is a [discriminated union](./discriminated-union.md) of [closed](./closed-map.md) [variants](./variant.md). That means each schema must match exactly one known shape, with no extra keys. So the meta-schema rejects a broken schema such as `{type:"string", items:{…}}`. A type system whose own type is loose would accept nonsense. <!-- id:W4Lj9Nfw -->

**Name kinds, don't define them.** The encoding defines what a `string` or a `link` is. The schema language only _names_ these [kinds](./kind.md), so a schema can ask for one. `link` and `bytes` are two more names beside `string`, with no structure of their own. <!-- id:trZZS__7 -->

**Representation is separate from kind.** A link is written `{"/":…}` in JSON, but it is not a map, and no schema treats it as one. Because a link is its own kind, the reserved `/` key of [dag-json](./dag-json.md) causes no confusion. A schema describes what a value _is_, not how one encoding spells it. <!-- id:xqXFLw1S -->

**One human form, one canonical form.** Authors write JSON. Publishing encodes each schema as [DAG-CBOR](./dag-cbor.md) and gives it a CID. References inside a schema stay `hm://` names in both forms. The two forms hold the same data, and software converts one to the other with no choices to make. See [encoding](./encoding.md). <!-- id:qUSAFSHU -->

# Decisions <!-- id:wrBZYU6X -->

- **`integer` / `float` split.** DAG-CBOR encodes them differently. If they were one type, a value could change when it is decoded and encoded again. So they stay separate, even though JSON has one number type. See [the data model](./data-model.md). <!-- id:7wmzNybN -->
- **`map`, not `object`.** The kind in the data model is `map`. A [struct](../struct.md) is a map with named fields, listed under `properties`. There is no separate object kind or struct kind. <!-- id:WqI0lbQ1 -->
- **Typed links via `target`.** `type:"link"` plus `target` gives the expected type of what the link points at. Every field that holds a reference shares that one key: a string field with `format: hm-url` or `ipfs-url` carries the same `target`. Links get no other keys of their own. A target is checked only when someone follows the link, never while the value itself is checked. See [references](./references.md) and [link-schema](./link-schema.md). <!-- id:WXk2ymW4 -->
- **References are names (`hm://` URLs), not CIDs.** Two blobs cannot hold each other's CID, because each would have to be finished first. Only names can express types that point at themselves or at each other, such as `example/folder` and `example/file`. Names need no special bundle format for such groups. A name resolves through a signing [authority](../authority.md). A CID pins one version that never changes. See [references](./references.md) and [URLs](../protocol/urls.md). <!-- id:l1_v0PJ1 -->
- **`type` is a URL, and it is the only key that names a type.** `type: "hm://hyper.media/map"` makes the kind a link you can click. The [primitive](./primitive.md) `map` schema is `{type: "hm://hyper.media/map"}`: it names itself, and nothing sits under it. The same `type` key points at another schema when the node includes or extends one. So naming a kind and naming a type work the same way. The validator does not fetch the kind's URL. It reads the word `map` at the end, so checking stays fast and works offline. <!-- id:UgN0v7lk -->
- **Extension by refinement.** `{ type: parent, …refinements }` [extends](./extension.md) the parent as a subtype: properties merge, each field keeps its own required flag, and closedness is kept. A bare `{ type: parent }` is a pure [include](./include-schema.md). The rule is one rule: `type` names, and `properties`, `values`, `items` or `target` refine. So there is no `extends` keyword. Example: `example/employee` extends `example/person`. <!-- id:VnxVNOdF -->
- **`anyOf` unions.** [`anyOf`](./anyof.md) lets `schema` be a discriminated union. It still describes itself: `anyOf` is a list of schemas, which the other keys can already express, and the meta-schema matches its own union variant. <!-- id:KShLNAZM -->
- **`allOf` intersections merge.** [`allOf`](./allof.md) says _and_ where `anyOf` says _or_. Its arms are structs, and they **merge** into one struct, the way an extension merges over its parent. They do not each check the value in turn. Structs are closed by default, so two closed arms checked one at a time would accept nothing. JSON Schema's `allOf` falls into that trap. Merging also makes the intersection a subtype of every arm, which is what a typed reference needs. Arms that disagree on a field accept nothing and say why. Extension has one parent, so it can express a chain, but not a type that is two things at once. Copying the other parent's fields does not help, because a copy is not a subtype.
- **Literals instead of `enum`.** A value is a schema of itself: `"Change"` accepts exactly `"Change"`. A fixed set of choices is a union of [literals](./literal-schema.md), `{anyOf: ["draft", "published"]}`. There is no `enum` keyword. Every choice can carry its own `description`, and a pinned tag is easy to read (`type: {value: "Change"}`). A literal can only be a string, integer, boolean or null. A map literal would look the same as a schema, and comparing two floats for equality is not reliable. <!-- id:ObA_urq1 -->
- **Closed maps by default.** A struct with `properties` and no `values` rejects unknown keys. This lets the discriminated union reject broken schemas. The cost: data with unknown fields is rejected, unless the schema allows them with `values`. <!-- id:NpAVn9EK -->
- **Generic abstraction (`params` / `var` / `args`).** The need is `Change<Block>`. An app gives its own set of [block](../protocol/blocks.md) types and gets a _strict_ Change, through every operation inside it, without copying the Change schema. A [type variable](./var-schema.md) is set once at the top and replaced everywhere below, through references. When nobody sets it, it uses a default, so plain use does not change. The feature still describes itself: `var` is a meta-schema variant, and `params` and `args` are maps of schemas on the existing variants. See [generics](./generic.md). <!-- id:5Il_ufHU -->
- **Presence, not nullability.** A missing key and a key set to `null` are different things. `required` says whether a key must be present. There is no `nullable` keyword. <!-- id:kwN7C5DC -->
- **Bytes are opaque.** A schema cannot limit the size of `bytes` or say what format they hold. <!-- id:O9a9U6oJ -->

# What Hypermedia Schemas are not <!-- id:h0dABmfh -->

<!-- id:utOrwOxn -->
| It is not <!-- col:DTSldmk2 --> | Because <!-- col:cveLwo3h --> <!-- id:gMG14EHP --> |
| --- | --- |
| a copy of JSON Schema | covering every case is not a goal; the language is small on purpose and must describe itself <!-- id:INWG0Cxy --> |
| [IPLD](./ipld.md) Schema | Hypermedia schemas are themselves IPLD data and hypermedia documents, and references are names that can recurse <!-- id:AMRqP6pA --> |
| a query or transformation language | it types data, nothing more; queries live in the hypermedia layer <!-- id:MWHaO1Hx --> |
| a layer that hides IPLD | links and content addressing are visible on purpose <!-- id:X7KnF8E7 --> |
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
