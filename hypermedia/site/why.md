---
name: Why Onyx
summary: The purpose of Onyx — what problem a self-describing type system solves for content-addressed hypermedia, who it serves, and what it deliberately is not.
---

# Why Onyx

The purpose of Onyx — what problem a self-describing type system solves for content-addressed hypermedia, who it serves, and what it deliberately is not.

## The problem

On a content-addressed network, a piece of data is a hash and some bytes. The hash proves *which* bytes you have; it says nothing about *what they mean*. Every reader has to already know the shape of what it is looking at.

The Hypermedia Network grew up that way. Its signed blobs — Change, Ref, Profile, Comment, Capability, Contact — had shapes hardcoded twice, once in the Go daemon and once in the TypeScript apps. Introducing a new kind of resource meant a code change on both sides and a release. Document metadata was an untyped bag of keys, so a "person" page and a "product" page were indistinguishable to software. And the agent system had grown its own, separate schema world for tool inputs and outputs — one the hypermedia core knew nothing about, so a tool could not return a real document and a document could not be fed to a tool without a hand-written translation layer.

Two fragmented schema worlds, and extensibility gated on releases. That is the problem Onyx exists to solve.

## What Onyx is

Onyx is a small schema language for IPLD data — the values DAG-CBOR can encode — designed so that the type system lives *inside* the network it describes rather than beside it. Three moves make that work.

**Types are data.** An Onyx schema is itself a DAG-CBOR block: same encoding, same content addressing, same signing and syncing as the data it types. A schema has a CID. It can be pinned, fetched, and verified like any other blob. There is no separate registry service to run or trust.

**Types are documents.** Every schema is also published as a normal Hypermedia document, owned by an account and reachable at an `hm://` URL. That gives types names, versions, human descriptions, and a place in the same browsable graph as everything else. A document declares what it is by pointing at one of these URLs. Because references are names rather than hashes, types can refer to each other in cycles — a folder that contains files that live in folders — which a pure hash graph cannot express. See [references & naming](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references).

**Types are minimal.** Nine kinds of value, seven shapes a schema can take, and one bar for every feature: the schema that defines what a schema is must remain a valid instance of itself. Onyx describes Onyx. That self-description is the design constraint, and it is what keeps the language from sprawling. See [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language) and [design rationale](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/design).

## What it makes possible

- **New resource types by publishing, not releasing.** To introduce a kind of thing, publish a schema document. Any app that can resolve the URL can validate, render forms for, and generate code for that kind — with no change to the core.
- **Typed documents.** A document can say which schema it conforms to, which schema its children must conform to, or which schema it *defines*. The editor turns required fields into always-present rows and flags out-of-spec data. See [typed documents](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/typed-documents).
- **One schema system for content and for tools.** A tool's contract is an input schema and an output schema; those are Onyx schemas, the same objects that type documents. A tool can emit a real document, and a document can be a tool's typed input, because both sides speak the same language.
- **A typed, self-documenting API.** Every read method of the Seed API is published as a schema that pins its method key and types its input and output. The in-app API console is generated from that catalog rather than hand-wired. See [the typed API](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/api).
- **Generated code.** Every schema becomes a TypeScript type, so the app's types are derived from the published schemas instead of being a second, drifting source of truth.
- **Machine-readable meaning for agents.** An agent that lands on an `hm://` document can follow its `schema` link and learn, precisely, what fields to expect and what they mean — the same way it would read a tool's contract. Types are discoverable by URL, not by out-of-band convention.

## Who it serves

**Readers** notice nothing, except that typed pages can render more richly — a person page can show a person, not a bag of keys.

**Authors** get guardrails: the attributes form knows which fields a document of this kind needs, offers the right controls for each (a dropdown for an enum, a searchable title pill for a document reference, a file picker for an IPFS reference), and points out what is out of spec — without ever refusing to save.

**Developers** get types in TypeScript, a browsable, linked reference for every schema, schema-driven forms for free, and a console for calling the API with validated inputs.

**Agents and tools** get contracts they can read and be checked against — the foundation for tools and agents that are themselves hypermedia resources.

## Guardrails, not gates

Validation in Onyx is deliberately two-speed. **At rest it is advisory**: a blob is a cryptographic fact, and you will routinely receive data whose schema you have not fetched or whose author used a newer version. The app stores it, renders what it can, and shows red, non-blocking warnings rather than refusing. **At a boundary it is strict**: the reference validator rejects malformed schemas outright, and a tool or API call is checked against its declared contract before it runs. Lenient where data lives, strict where it is acted on.

## What Onyx is not

| It is not | Because |
| --- | --- |
| a re-implementation of JSON Schema | breadth is a non-goal; Onyx is intentionally tiny and must stay self-describing |
| IPLD Schema | Onyx schemas are themselves IPLD data and hypermedia documents, and references are names that can recurse |
| a query or transformation language | it types data, nothing more; queries live in the hypermedia layer |
| an abstraction over IPLD | links and content addressing are surfaced on purpose; they are the point |
| a gate on writing | violations warn; they never block a save |

## Where to go next

Read [how Onyx works](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/how-it-works) for the system end to end, [typed documents](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/typed-documents) for the document-binding model, or go straight to the reference chapters from the [home page](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb).
