---
name: Why Schemas
summary: The purpose of Hypermedia Schemas, the problem a self-describing type system solves for content-addressed hypermedia, who it serves, and what it does not try to be.
---
# The problem <!-- id:hdD9n48L -->

On a content-addressed network, a piece of data is a hash and some bytes. The hash proves _which_ bytes you have. It says nothing about _what they mean_. Every reader has to know the shape of the data in advance. <!-- id:jkCV8kpL -->

The Hypermedia Network grew up that way. Its [signed blobs](../protocol/blobs.md) ([Change](../change.md), [Ref](../ref.md), [Profile](../profile.md), [Comment](../comment.md), [Capability](../capability.md), [Contact](../contact.md)) had shapes hardcoded twice: once in the Go [daemon](../apps/daemon.md) and once in the TypeScript apps. A new kind of resource needed a code change on both sides and a release. [Document metadata](../metadata.md) was an untyped bag of keys, so software could not tell a "person" page from a "product" page. The [agent system](../agent.md) had its own separate schema world for tool inputs and outputs. The hypermedia core knew nothing about it. A tool could not return a real [document](../protocol/documents.md), and a document could not be passed to a tool without a hand-written translation layer. <!-- id:yvfqtls7 -->

So there were two separate schema worlds, and adding a type needed a release. Hypermedia Schemas solve that. <!-- id:lj7oo6SS -->

# What Hypermedia Schemas are <!-- id:MEFQ9YNs -->

Hypermedia Schemas is a small schema language for [IPLD](./ipld.md) data, the values [DAG-CBOR](./dag-cbor.md) can encode. The type system lives inside the network it describes. Three design choices make that work. <!-- id:6gPvbn7m -->

**Types are data.** A Hypermedia schema is itself a DAG-CBOR block. It uses the same encoding, content addressing, signing and syncing as the data it types. A schema has a [CID](../cid.md). You can pin, fetch and verify it like any other blob. There is no separate registry service to run or trust. <!-- id:DQpYhLZV -->

**Types are documents.** Every schema is also published as a normal Hypermedia document, owned by an [account](../protocol/identity.md) and reachable at an [`hm://` URL](../protocol/urls.md). That gives types names, versions, human descriptions, and a place in the same browsable graph as everything else. A document declares what it is by pointing at one of these URLs. References are names, so types can refer to each other in cycles, such as a folder that contains files that live in folders. A pure hash graph cannot express that. See [references and naming](./references.md). <!-- id:o9b8CRI8 -->

**Types are minimal.** There are nine [kinds](./kind.md) of value and nine shapes a schema can take. Every feature has to pass one test: the schema that defines what a schema is must stay a valid instance of itself. The [meta-schema](../schema.md) describes itself. That [self-description](./self-description.md) is the design constraint, and it keeps the language small. See [the schema language](./schema-language.md) and [design rationale](./design.md). <!-- id:ejkukc5O -->

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

Validation has two modes. **At rest it is advisory.** A blob is a cryptographic fact, and you will often receive data whose schema you have not fetched, or whose author used a newer version. The app stores it, renders what it can, and shows red warnings that do not block anything. **At a boundary it is strict.** The reference validator rejects malformed schemas, and a tool or API call is checked against its declared contract before it runs. Validation is lenient where data is stored and strict where it is acted on. <!-- id:VaWhKFCl -->

# What Hypermedia Schemas are not <!-- id:h0dABmfh -->

<!-- id:utOrwOxn -->
| It is not <!-- col:DTSldmk2 --> | Because <!-- col:cveLwo3h --> <!-- id:gMG14EHP --> |
| --- | --- |
| a re-implementation of JSON Schema | breadth is a non-goal; the language is intentionally tiny and must stay self-describing <!-- id:INWG0Cxy --> |
| IPLD Schema | Hypermedia schemas are themselves IPLD data and hypermedia documents, and references are names that can recurse <!-- id:AMRqP6pA --> |
| a query or transformation language | it types data, nothing more; queries live in the hypermedia layer <!-- id:MWHaO1Hx --> |
| an abstraction over IPLD | links and content addressing are visible on purpose <!-- id:X7KnF8E7 --> |
| a gate on writing | violations warn; they never block a save <!-- id:BMF06lQT --> |

# Where to go next <!-- id:sHUHAcIF -->

Read [how Hypermedia Schemas work](./how-it-works.md) for the whole system, [typed documents](./typed-documents.md) for how documents bind to schemas, or go to the reference chapters from the [schema home page](../schema.md). <!-- id:mdWI56L4 -->

# See also <!-- id:_1bOSofL -->

- [How Hypermedia Schemas work](./how-it-works.md): the pipeline from schema file to signed blob and typed API call. <!-- id:HLGbgqGX -->
- [Typed documents](./typed-documents.md): `attributesSchema`, `childAttributesSchema` and `schemaDefinition`. <!-- id:OWulMFtU -->
- [Design rationale](./design.md): the decisions behind the language. <!-- id:CNDxZ3Km -->
- [References and naming](./references.md): why names make recursive types possible. <!-- id:Q9IqdtnW -->
- [Blobs](../protocol/blobs.md): the signed data the schemas describe. <!-- id:C9hGMBp- -->
- [Documents](../protocol/documents.md): the resources that carry and define schemas. <!-- id:6-gP2gk9 -->
- [Metadata](../metadata.md): the document attributes a schema types. <!-- id:TXBSw0rH -->
