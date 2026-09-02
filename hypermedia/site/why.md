---
name: Why Onyx
summary: The purpose of Onyx — what problem a self-describing type system solves for content-addressed hypermedia, who it serves, and what it deliberately is not.
---
# The problem <!-- id:hdD9n48L -->
On a content-addressed network, a piece of data is a hash and some bytes. The hash proves _which_ bytes you have; it says nothing about _what they mean_. Every reader has to already know the shape of what it is looking at. <!-- id:jkCV8kpL -->

The Hypermedia Network grew up that way. Its signed blobs — Change, Ref, Profile, Comment, Capability, Contact — had shapes hardcoded twice, once in the Go daemon and once in the TypeScript apps. Introducing a new kind of resource meant a code change on both sides and a release. Document metadata was an untyped bag of keys, so a "person" page and a "product" page were indistinguishable to software. And the agent system had grown its own, separate schema world for tool inputs and outputs — one the hypermedia core knew nothing about, so a tool could not return a real document and a document could not be fed to a tool without a hand-written translation layer. <!-- id:yvfqtls7 -->

Two fragmented schema worlds, and extensibility gated on releases. That is the problem Onyx exists to solve. <!-- id:lj7oo6SS -->

# What Onyx is <!-- id:MEFQ9YNs -->
Onyx is a small schema language for IPLD data — the values DAG-CBOR can encode — designed so that the type system lives _inside_ the network it describes rather than beside it. Three moves make that work. <!-- id:6gPvbn7m -->

**Types are data.** An Onyx schema is itself a DAG-CBOR block: same encoding, same content addressing, same signing and syncing as the data it types. A schema has a CID. It can be pinned, fetched, and verified like any other blob. There is no separate registry service to run or trust. <!-- id:DQpYhLZV -->

**Types are documents.** Every schema is also published as a normal Hypermedia document, owned by an account and reachable at an `hm://` URL. That gives types names, versions, human descriptions, and a place in the same browsable graph as everything else. A document declares what it is by pointing at one of these URLs. Because references are names rather than hashes, types can refer to each other in cycles — a folder that contains files that live in folders — which a pure hash graph cannot express. See [references & naming](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/references). <!-- id:o9b8CRI8 -->

**Types are minimal.** Nine kinds of value, seven shapes a schema can take, and one bar for every feature: the schema that defines what a schema is must remain a valid instance of itself. Onyx describes Onyx. That self-description is the design constraint, and it is what keeps the language from sprawling. See [the schema language](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema-language) and [design rationale](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/design). <!-- id:ejkukc5O -->

# What it makes possible <!-- id:n8_sc-MO -->
- **New resource types by publishing, not releasing.** To introduce a kind of thing, publish a schema document. Any app that can resolve the URL can validate, render forms for, and generate code for that kind — with no change to the core. <!-- id:Ku-kyWNg -->
- **Typed documents.** A document can say which schema it conforms to, which schema its children must conform to, or which schema it _defines_. The editor turns required fields into always-present rows and flags out-of-spec data. See [typed documents](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/typed-documents). <!-- id:5kYrfz-H -->
- **One schema system for content and for tools.** A tool's contract is an input schema and an output schema; those are Onyx schemas, the same objects that type documents. A tool can emit a real document, and a document can be a tool's typed input, because both sides speak the same language. <!-- id:EWBxFyCH -->
- **A typed, self-documenting API.** Every read method of the Seed API is published as a schema that pins its method key and types its input and output. The in-app API console is generated from that catalog rather than hand-wired. See [the typed API](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/api). <!-- id:PQWGKvZO -->
- **Generated code.** Every schema becomes a TypeScript type, so the app's types are derived from the published schemas instead of being a second, drifting source of truth. <!-- id:du8NMRdv -->
- **Machine-readable meaning for agents.** An agent that lands on an `hm://` document can follow its `schema` link and learn, precisely, what fields to expect and what they mean — the same way it would read a tool's contract. Types are discoverable by URL, not by out-of-band convention. <!-- id:wnqV6OF- -->

# Who it serves <!-- id:YPiEjlT9 -->
**Readers** notice nothing, except that typed pages can render more richly — a person page can show a person, not a bag of keys. <!-- id:TAte4XSS -->

**Authors** get guardrails: the attributes form knows which fields a document of this kind needs, offers the right controls for each (a dropdown for an enum, a searchable title pill for a document reference, a file picker for an IPFS reference), and points out what is out of spec — without ever refusing to save. <!-- id:mIlfg1bz -->

**Developers** get types in TypeScript, a browsable, linked reference for every schema, schema-driven forms for free, and a console for calling the API with validated inputs. <!-- id:U77YK0ax -->

**Agents and tools** get contracts they can read and be checked against — the foundation for tools and agents that are themselves hypermedia resources. <!-- id:d4tnck1j -->

# Guardrails, not gates <!-- id:IYcGoiB1 -->
Validation in Onyx is deliberately two-speed. **At rest it is advisory**: a blob is a cryptographic fact, and you will routinely receive data whose schema you have not fetched or whose author used a newer version. The app stores it, renders what it can, and shows red, non-blocking warnings rather than refusing. **At a boundary it is strict**: the reference validator rejects malformed schemas outright, and a tool or API call is checked against its declared contract before it runs. Lenient where data lives, strict where it is acted on. <!-- id:VaWhKFCl -->

# What Onyx is not <!-- id:h0dABmfh -->
<!-- id:utOrwOxn -->
| It is not <!-- col:dd-nz8aA --> | Because <!-- col:Gff2LIs1 --> <!-- id:YWUUKFtB --> |
| --- | --- |
| a re-implementation of JSON Schema | breadth is a non-goal; Onyx is intentionally tiny and must stay self-describing <!-- id:XeRU14SK --> |
| IPLD Schema | Onyx schemas are themselves IPLD data and hypermedia documents, and references are names that can recurse <!-- id:ToAJw2Gp --> |
| a query or transformation language | it types data, nothing more; queries live in the hypermedia layer <!-- id:0r4LfnVm --> |
| an abstraction over IPLD | links and content addressing are surfaced on purpose; they are the point <!-- id:SG2QYEJ- --> |
| a gate on writing | violations warn; they never block a save <!-- id:nlWw3Isl --> |

# Where to go next <!-- id:sHUHAcIF -->
Read [how Onyx works](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/how-it-works) for the system end to end, [typed documents](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/typed-documents) for the document-binding model, or go straight to the reference chapters from the [home page](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb). <!-- id:mdWI56L4 -->