---
name: Hypermedia
icon: ipfs://bafkreicavdhyxlnlw5o67sbsq5lu5jiwsuvikmnh6r4m3kh3vckg6uzjpi
summary: The developer knowledge base for the Hypermedia protocol and the Seed software that implements it, published from the Seed repository itself.
---
Hypermedia is a protocol for publishing [documents](./protocol/documents.md) and [discussions](./protocol/comments.md) that belong to their authors, with no server in charge of them. Every document is a [signed](./protocol/blobs.md), content-addressed history of changes. Every [account](./protocol/identity.md) is a cryptographic key. Every [link](./protocol/urls.md) can point at an exact version, an exact [block](./protocol/blocks.md), or an exact range of text. Content stays readable and verifiable as long as anyone still holds a copy. <!-- id:-gK0HbNj -->

Seed is the open-source software that implements the protocol. It has a [daemon](./software/daemon.md) that stores the data and syncs it over a [peer-to-peer network](./protocol/network.md), a [desktop app](./software/desktop.md) and a [web app](./software/web.md) for reading, writing and discussing, a [command-line tool](./build/cli.md), a [hosted agent runtime](./agent.md), and a TypeScript [SDK](./build/sdk.md). Think of the split as HTTP and a browser. The protocol defines identity, documents, changes, links and [permissions](./protocol/permissions.md). Seed is one implementation, and the team hopes it will not be the last. <!-- id:_G1k0qF- -->

This site holds what stays true: the concepts, the types, the reference and the workflows. The pages are markdown files in the Seed repository under `hypermedia/`, and the Seed app can edit them in place. Every page opens in plain language, links its terms to the [glossary](./glossary.md), and then gets precise.

# The ideas

The protocol is a small set of things. [The Hypermedia protocol](./protocol.md) tours them in order; each has a page.

- **A key is an account, and an account is a space.** [Identity](./protocol/identity.md) explains keys and accounts. [Spaces and paths](./protocol/spaces.md) explains where documents live.
- **Everything is a signed blob.** [Blobs](./protocol/blobs.md) covers the envelope and the six blob types. [Integrity](./protocol/integrity.md) says what is verified and what is trusted.
- **A document is a history of changes.** [Documents](./protocol/documents.md) are built from [changes](./change.md) and placed by [refs](./ref.md). Their content is a tree of [blocks](./protocol/blocks.md).
- **A link can point at an exact version, block or range.** [URLs](./protocol/urls.md) gives the grammar. [Links and citations](./protocol/links-and-citations.md) covers backlinks and mentions.
- **Access is delegated, key to key.** [Permissions](./protocol/permissions.md) covers capabilities and roles. [Contacts](./protocol/contacts.md) covers following and membership. [Privacy](./protocol/privacy.md) covers private content.
- **People talk about documents.** [Comments](./protocol/comments.md) are records in their author's space.
- **Content moves between peers.** [Network](./protocol/network.md) covers sync and discovery, [sites](./protocol/sites.md) put a space on a domain, and [files](./protocol/files.md) covers attachments.

[Why Hypermedia](./why.md) gives the motivation for any reader.

# What you make with it

Some documents are more than text. Each kind has a page at the address of its type.

- An [app](./app.md) is a document that holds tools, pages and triggers.
- A [tool](./tool.md) is a function an app environment runs for an app or an agent.
- A [page](./page.md) is a document that opens as a sandboxed HTML page.
- A [trigger](./trigger.md) starts a tool or an agent when something happens.
- An [agent](./agent.md) is a language model with a memory, tools and its own keys, which reads and writes Hypermedia like any other participant.

[Hypermedia Schemas](./schema.md) is the type system behind all of them. The [catalogue of types](./schema/types.md) lists every type on this site, and [examples](./example.md) shows schemas and typed instances.

# Doing things

- **Build on Hypermedia.** [Building on Hypermedia](./build.md) has the references (the [Seed API](./build/web-api.md), the [SDK](./build/sdk.md), the [CLI](./build/cli.md)) and the guides by task.
- **Run it.** [Running Seed](./operate.md) covers a site, a node and an app environment.
- **Change it.** [Working on Seed](./contribute.md) is for contributors to the repository.
- **Find a program.** [The Seed software](./software.md) has one map page per program.

# For agents <!-- id:GB3nY3rU -->

These pages are written for agents as well as people. Every concept page ends with a "Working with it" section that covers the Seed app, the CLI, the SDK, the web API, and agents. If you are an agent reading this site through the seed-cli skill or the Seed API, start with [Building with agents](./build/agents.md), [the CLI reference](./build/cli.md), and [the Seed API](./build/web-api.md). The `/api/Resource` request key on any Seed site returns a document as JSON, and appending `.md` to a page URL returns its markdown. <!-- id:myu_MyLi -->

# Where the source lives <!-- id:-YxSfaki -->

The Seed repository is public at [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). This folder is `hypermedia/` in that repository. [Publish a folder](./build/publish-a-folder.md) explains the round trip between a git folder and a Hypermedia space that keeps these pages in sync. To contribute a correction, edit the markdown and open a pull request, or edit the page in the Seed app and let the sync bring it back to git. See [Contributing](./contribute/contributing.md). <!-- id:-H2vfuhJ -->

# Sections <!-- id:d4RLpinJ attrs:{"childrenType":"Grid","columnCount":3} -->

<./why.md> <!-- id:Ynzjo94z type:Embed attrs:{"view":"Card"} -->

<./protocol.md> <!-- id:lb6j814F type:Embed attrs:{"view":"Card"} -->

<./schema.md> <!-- id:vtPgA4Zt type:Embed attrs:{"view":"Card"} -->

<./example.md> <!-- id:vqXREeen type:Embed attrs:{"view":"Card"} -->

<./agent.md> <!-- id:1KSMcFEJ type:Embed attrs:{"view":"Card"} -->

<./build.md> <!-- id:YEuQdeP2 type:Embed attrs:{"view":"Card"} -->

<./operate.md> <!-- id:oKTploE2 type:Embed attrs:{"view":"Card"} -->

<./contribute.md> <!-- id:GSXkCzl0 type:Embed attrs:{"view":"Card"} -->

<./software.md> <!-- id:Wyws1he9 type:Embed attrs:{"view":"Card"} -->

<./glossary.md> <!-- id:rI01TQ8d type:Embed attrs:{"view":"Card"} -->

# What you make <!-- id:VczIu7MR attrs:{"childrenType":"Grid","columnCount":3} -->

<./app.md> <!-- id:IIE7bTHi type:Embed attrs:{"view":"Card"} -->

<./tool.md> <!-- id:4YDtF6O2 type:Embed attrs:{"view":"Card"} -->

<./page.md> <!-- id:oAdpusPX type:Embed attrs:{"view":"Card"} -->

<./page-input.md> <!-- id:etM5VR1I type:Embed attrs:{"view":"Card"} -->

<./trigger.md> <!-- id:zQPJyCZz type:Embed attrs:{"view":"Card"} -->

# Protocol types <!-- id:dxTTxYQG attrs:{"childrenType":"Grid","columnCount":3} -->

<./blob.md> <!-- id:H8b1EOtq type:Embed attrs:{"view":"Card"} -->

<./change.md> <!-- id:2GRRUxZI type:Embed attrs:{"view":"Card"} -->

<./ref.md> <!-- id:2vm6cHlW type:Embed attrs:{"view":"Card"} -->

<./document.md> <!-- id:SA88lKwX type:Embed attrs:{"view":"Card"} -->

<./block.md> <!-- id:dyTM3rP7 type:Embed attrs:{"view":"Card"} -->

<./comment.md> <!-- id:jbjfiNMr type:Embed attrs:{"view":"Card"} -->

<./capability.md> <!-- id:cU01thVr type:Embed attrs:{"view":"Card"} -->

<./contact.md> <!-- id:Cv66othy type:Embed attrs:{"view":"Card"} -->

<./profile.md> <!-- id:aW1n8U9O type:Embed attrs:{"view":"Card"} -->

<./metadata.md> <!-- id:AqYbeSyi type:Embed attrs:{"view":"Card"} -->

<./query.md> <!-- id:ffIQRmcH type:Embed attrs:{"view":"Card"} -->

<./account.md> <!-- id:4T0MZZee type:Embed attrs:{"view":"Card"} -->

<./authority.md> <!-- id:BTkNe2g7 type:Embed attrs:{"view":"Card"} -->

<./link.md> <!-- id:8mi0zkbc type:Embed attrs:{"view":"Card"} -->

<./role.md> <!-- id:AfmitHEx type:Embed attrs:{"view":"Card"} -->

<./visibility.md> <!-- id:eHK9gwvg type:Embed attrs:{"view":"Card"} -->

<./signature.md> <!-- id:1BinpM6h type:Embed attrs:{"view":"Card"} -->

<./principal.md> <!-- id:rblSeWul type:Embed attrs:{"view":"Card"} -->

# Value types <!-- id:1e0XUIvV attrs:{"childrenType":"Grid","columnCount":3} -->

<./value.md> <!-- id:vwSdsYVl type:Embed attrs:{"view":"Card"} -->

<./any.md> <!-- id:l7FfOUpa type:Embed attrs:{"view":"Card"} -->

<./none.md> <!-- id:9wRxk0Sl type:Embed attrs:{"view":"Card"} -->

<./null.md> <!-- id:i9vnOr0z type:Embed attrs:{"view":"Card"} -->

<./boolean.md> <!-- id:f0gCNBsc type:Embed attrs:{"view":"Card"} -->

<./integer.md> <!-- id:4IMEAeUm type:Embed attrs:{"view":"Card"} -->

<./float.md> <!-- id:YOYRquAF type:Embed attrs:{"view":"Card"} -->

<./string.md> <!-- id:1Qn47y02 type:Embed attrs:{"view":"Card"} -->

<./bytes.md> <!-- id:z9mLUXCt type:Embed attrs:{"view":"Card"} -->

<./cid.md> <!-- id:7ExynST9 type:Embed attrs:{"view":"Card"} -->

<./list.md> <!-- id:DrjpV3Lo type:Embed attrs:{"view":"Card"} -->

<./map.md> <!-- id:VQM6JPTe type:Embed attrs:{"view":"Card"} -->

<./struct.md> <!-- id:03Bji5ux type:Embed attrs:{"view":"Card"} -->

<./key-value.md> <!-- id:qPnqsQ9D type:Embed attrs:{"view":"Card"} -->

<./date.md> <!-- id:sbH7PhTl type:Embed attrs:{"view":"Card"} -->

<./date-time.md> <!-- id:f4Es55Qt type:Embed attrs:{"view":"Card"} -->

<./timestamp.md> <!-- id:TAXvkYIj type:Embed attrs:{"view":"Card"} -->

<./url.md> <!-- id:8NpfAYL4 type:Embed attrs:{"view":"Card"} -->

<./hm-url.md> <!-- id:ZZNvvsCP type:Embed attrs:{"view":"Card"} -->

<./ipfs-url.md> <!-- id:A4dLZuF1 type:Embed attrs:{"view":"Card"} -->
