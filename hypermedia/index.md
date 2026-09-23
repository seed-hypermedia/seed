---
name: Seed Hypermedia
summary: The developer knowledge base for the Hypermedia protocol and the Seed software that implements it, published from the Seed repository itself.
---
Hypermedia is a protocol for publishing [documents](./protocol/documents.md) and [discussions](./protocol/comments.md) that belong to their authors, with no server in charge of them. Every document is a [signed](./protocol/blobs.md), content-addressed history of changes. Every [account](./protocol/identity.md) is a cryptographic key. Every [link](./protocol/urls.md) can point at an exact version, an exact [block](./protocol/blocks.md), or an exact range of text. Content stays readable and verifiable as long as anyone still holds a copy. <!-- id:-gK0HbNj -->

Seed is the open-source software that implements the protocol. It has a [daemon](./apps/daemon.md) that stores the data and syncs it over a [peer-to-peer network](./protocol/network.md), a [desktop app](./apps/desktop.md) and a [web app](./apps/web.md) for reading, writing and discussing, a [command-line tool](./build/cli.md), a [hosted agent runtime](./agent.md), and a TypeScript [SDK](./build/sdk.md). Think of the split as HTTP and a browser. The protocol defines identity, documents, changes, links and [permissions](./protocol/permissions.md). Seed is one implementation, and the team hopes it will not be the last. <!-- id:_G1k0qF- -->

These pages are markdown files in the Seed repository under `hypermedia/`. A commit to the main branch publishes them to this site, and the Seed app can edit them in place, so what you read matches what the code ships with. Every page opens in plain language, links its terms to the [glossary](./glossary.md), and then gets precise. <!-- id:toSHUdAE -->

# Where to start <!-- id:qquyu_Qe -->

- **Understand the protocol.** Start with [The Hypermedia protocol](./protocol.md). It is a layered tour from keys to blobs to documents, links, permissions, comments, privacy, the network and sites. Each stop links the page with the exact model and a worked example. <!-- id:m2GuhDRm -->
- **Build on it.** Start with [Building on Hypermedia](./build.md). The [Seed API](./build/web-api.md) that every site serves and the [SDK](./build/sdk.md) are the main entry points. The [CLI](./build/cli.md) and [agent skills](./build/agents.md) are for scripting. The daemon [gRPC API](./build/grpc.md) and libp2p are for deep integration. <!-- id:4Fo9jG63 -->
- **Run the software.** Start with [The Seed software](./apps.md), which has one page per app: desktop, web, daemon, CLI, notify, vault, mobile, explorer and agents. [Self-hosting](./build/self-hosting.md) explains how to run a [site](./protocol/sites.md) of your own. <!-- id:FqXY_ljX -->

# Why Hypermedia <!-- id:G9c9jn03 -->

[Why Hypermedia](./why.md) explains the motivation for any reader: [the end of broken links](./why/broken-links.md), [signed content instead of server trust](./why/signed-content.md), [open editing](./why/open-editing.md), [a network for thought](./why/network-for-thought.md), and [the lineage](./why/inspirations.md) from Engelbart and Xanadu to IPFS and Automerge. <!-- id:lsYfVMeq -->

# The map <!-- id:v3ihjVoi -->

<!-- id:B3k8aLrM -->
| Section <!-- col:PuQ6FrT- --> | What lives there <!-- col:T2rXXR4T --> <!-- id:_qrkQ37L --> |
| --- | --- |
| [Why](./why.md) | The motivation and the inspirations, for any reader. <!-- id:AKFK6Vu- --> |
| [Protocol](./protocol.md) | The Hypermedia protocol explained by concept: [identity](./protocol/identity.md), [blobs](./protocol/blobs.md), [documents](./protocol/documents.md), [blocks](./protocol/blocks.md), [URLs](./protocol/urls.md), [permissions](./protocol/permissions.md), [privacy](./protocol/privacy.md), [integrity](./protocol/integrity.md), [network](./protocol/network.md), [sites](./protocol/sites.md), [comments](./protocol/comments.md), [files](./protocol/files.md). <!-- id:Ag9KVF13 --> |
| Term pages | Each blob and value type has its own page with the formal schema attached: [blob](./blob.md), [change](./change.md), [ref](./ref.md), [document](./document.md), [block](./block.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md), [metadata](./metadata.md), [query](./query.md), [cid](./cid.md), [principal](./principal.md), [visibility](./visibility.md) and more. <!-- id:tCyoXf1D --> |
| [Schemas](./schema.md) | Hypermedia Schemas, the self-describing type system for content-addressed data, and how documents bind to a schema. <!-- id:Nvjpu90L --> |
| [Build](./build.md) | Task guides: [getting started](./build/getting-started.md), [the web API](./build/web-api.md), [gRPC](./build/grpc.md), [the SDK](./build/sdk.md), [the CLI](./build/cli.md), [agents](./build/agents.md), [keys](./build/keys.md), [sign in with Seed](./build/sign-in.md), [publish a folder](./build/publish-a-folder.md), [self-hosting](./build/self-hosting.md), [the query grammar](./build/query-grammar.md), [contributing](./build/contributing.md). <!-- id:YvFfuP_o --> |
| [Agents](./agent.md) | Seed Agents, the hosted agent runtime. An agent has a [space](./agent/space.md), tools and [triggers](./agent/triggers.md), and reads and writes Hypermedia through the Seed API with delegated keys. <!-- id:Jyf-DAx2 --> |
| [Apps](./apps.md) | The Seed software, one page per program. <!-- id:IUS1Ivva --> |
| [Examples](./example.md) | Example schemas and typed instances. <!-- id:xVNduUPu --> |
| [Glossary](./glossary.md) | Every term in one line, with a table of retired names. <!-- id:dvqdYbSA --> |

# Where this is going <!-- id:dP4wg_p_ -->

The protocol is in active design. Concept pages describe what the daemon does today. Direction that is decided but not built lives on one dated page, [Where this is going](./protocol/roadmap.md), and the pages it affects link to it. Seed Agents keeps its own live [roadmap](./agent/roadmap.md). <!-- id:yJc-YqvE -->

# For agents <!-- id:GB3nY3rU -->

These pages are written for agents as well as people. Every concept page ends with a "Working with it" section that covers the Seed app, the CLI, the SDK, the web API, and agents. If you are an agent reading this site through the seed-cli skill or the Seed API, start with [Building with agents](./build/agents.md), [the CLI reference](./build/cli.md), and [the Seed API](./build/web-api.md). The `/api/Resource` request key on any Seed site returns a document as JSON, and appending `.md` to a page URL returns its markdown. <!-- id:myu_MyLi -->

# Where the source lives <!-- id:-YxSfaki -->

The Seed repository is public at [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). This folder is `hypermedia/` in that repository. [Publish a folder](./build/publish-a-folder.md) explains the round trip between a git folder and a Hypermedia space that keeps these pages in sync. To contribute a correction, edit the markdown and open a pull request, or edit the page in the Seed app and let the sync bring it back to git. See [Contributing](./build/contributing.md). <!-- id:-H2vfuhJ -->
