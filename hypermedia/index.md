---
name: Seed Hypermedia
summary: The developer knowledge base for the Hypermedia protocol and the Seed software that implements it, published from the Seed repository itself.
---
Hypermedia is a protocol for publishing documents and discussions that belong to their authors rather than to a server. Every document is a signed, content-addressed history of changes, every account is a cryptographic key, and every link can point at an exact version, an exact block, or an exact range of text. Content stays readable and verifiable as long as anyone still holds a copy.

Seed is the open-source software that implements the protocol: a daemon that stores and syncs the data over a peer-to-peer network, a desktop app and a web app for reading, writing and discussing, a command-line tool, a hosted agent runtime, and a TypeScript SDK. Think of the split as HTTP versus a browser. The protocol defines identity, documents, changes, links and permissions. Seed is one implementation, and the team hopes it will not be the last.

These pages are markdown files in the Seed repository under `hypermedia/`. A commit to the main branch publishes them to this site, and the Seed app can edit them in place, so what you read is exactly what the code ships with. Every page opens in plain language, links its terms to the [glossary](./glossary.md), and then gets precise.

# Three doors

- **Understand the protocol.** Start with [The Hypermedia protocol](./protocol.md), a layered tour from keys to blobs to documents, links, permissions, comments, privacy, the network and sites. Each stop links the page with the exact model and a worked example.
- **Build on it.** Start with [Building on Hypermedia](./build.md). The Seed API served by every site and the [SDK](./build/sdk.md) are the canonical entry points. The [CLI](./build/cli.md) and agent skills are for scripting. The daemon [gRPC API](./build/grpc.md) and libp2p are for deep integration.
- **Run the software.** Start with [The Seed software](./apps.md), one map page per app: desktop, web, daemon, CLI, notify, vault, mobile, explorer and agents. [Self-hosting](./build/self-hosting.md) explains how to run a site of your own.

# Why Hypermedia

[Why Hypermedia](./why.md) is the motivation, written for any reader: [the end of broken links](./why/broken-links.md), [signed content instead of server trust](./why/signed-content.md), [open editing](./why/open-editing.md), [a network for thought](./why/network-for-thought.md), and [the lineage](./why/inspirations.md) from Engelbart and Xanadu to IPFS and Automerge.

# The map

| Section | What lives there |
| --- | --- |
| [Why](./why.md) | The motivation and the inspirations, for any reader. |
| [Protocol](./protocol.md) | The Hypermedia protocol explained by concept: [identity](./protocol/identity.md), [blobs](./protocol/blobs.md), [documents](./protocol/documents.md), [blocks](./protocol/blocks.md), [URLs](./protocol/urls.md), [permissions](./protocol/permissions.md), [privacy](./protocol/privacy.md), [integrity](./protocol/integrity.md), [network](./protocol/network.md), [sites](./protocol/sites.md), [comments](./protocol/comments.md), [files](./protocol/files.md). |
| Term pages | The blob and value types have their own pages with the formal schema attached: [blob](./blob.md), [change](./change.md), [ref](./ref.md), [document](./document.md), [block](./block.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md), [metadata](./metadata.md), [query](./query.md), [cid](./cid.md), [principal](./principal.md), [visibility](./visibility.md) and more. |
| [Schemas](./schema.md) | Hypermedia Schemas, the self-describing type system for content-addressed data, and how documents bind to a schema. |
| [Seed API](./rpc.md) | The typed read API every Seed site serves, one page per request key. |
| [Build](./build.md) | Task guides: [getting started](./build/getting-started.md), [the web API](./build/web-api.md), [gRPC](./build/grpc.md), [the SDK](./build/sdk.md), [the CLI](./build/cli.md), [agents](./build/agents.md), [keys](./build/keys.md), [sign in with Seed](./build/sign-in.md), [publish a folder](./build/publish-a-folder.md), [self-hosting](./build/self-hosting.md), [extensions](./build/extensions.md), [the query grammar](./build/query-grammar.md), [contributing](./build/contributing.md). |
| [Agents](./agent.md) | Seed Agents, the hosted agent runtime: an agent has a space, tools and triggers, and reads and writes Hypermedia through the Seed API with delegated keys. |
| [Apps](./apps.md) | The Seed software, one map page per program. |
| [Examples](./example.md) | Example schemas and typed instances. |
| [Glossary](./glossary.md) | Every term in one line, with a table of retired names. |
| [History](./history.md) | Dated design records that still inform the code. |

# Where this is going

The protocol is in active design. Concept pages describe what the daemon does today; direction that has been decided but not built is collected on one dated page, [Where this is going](./protocol/roadmap.md), and linked from the pages it affects. Seed Agents keeps its own live [roadmap](./agent/roadmap.md).

# For agents

Seed treats agents as a first-class surface. Every concept page ends with a "Working with it" section that covers the Seed app, the CLI, the SDK, the web API, and agents. If you are an agent reading this site through the seed-cli skill or the Seed API, the fastest routes are [Building with agents](./build/agents.md), [the CLI reference](./build/cli.md), and [the Seed API](./rpc.md). The `/api/Resource` request key on any Seed site returns a document as JSON, and appending `.md` to a page URL returns its markdown.

# Where the source lives

The Seed repository is public at [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). This folder is `hypermedia/` in that repository, and [Publish a folder](./build/publish-a-folder.md) explains the round trip between a git folder and a Hypermedia space that keeps these pages in sync. To contribute a correction, edit the markdown and open a pull request, or edit the page in the Seed app and let the sync bring it back to git.
