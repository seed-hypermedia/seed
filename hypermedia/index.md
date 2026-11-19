---
name: Hypermedia
icon: ipfs://bafkreicavdhyxlnlw5o67sbsq5lu5jiwsuvikmnh6r4m3kh3vckg6uzjpi
summary: This site explains the Hypermedia protocol and the Seed software that runs it, in plain words first and exact detail after.
---
Hypermedia is a way to publish [documents](./protocol/documents.md) and [discussions](./protocol/comments.md) that belong to the people who write them. No server is in charge. Your [account](./protocol/identity.md) is a key that you hold, and you [sign](./protocol/blobs.md) everything you publish with it. A [link](./protocol/urls.md) can point at one exact version of a document, at one [block](./protocol/blocks.md) such as a paragraph, or at a few words inside it. Anyone who holds a copy can serve it, and anyone can check that it is real. <!-- id:-gK0HbNj -->

Seed is the open-source software that runs the protocol. Think of HTTP and a browser: Hypermedia is the protocol, and Seed is one program that speaks it. Seed has several parts: <!-- id:_G1k0qF- -->

- The [daemon](./software/daemon.md) stores the data and syncs it with other computers over a [peer-to-peer network](./protocol/network.md).
- The [Seed app](./software/desktop.md) and the [web app](./software/web.md) are where you read, write and discuss.
- The [CLI](./build/cli.md) is the command-line tool, and the [SDK](./build/sdk.md) is the TypeScript library.
- [Agents](./agent.md) are language models that read and write Hypermedia with their own keys.

This site holds what stays true: the ideas, the types, the reference and the steps for common tasks. Every page opens in plain language and then gets precise. The [glossary](./glossary.md) defines every term in one place. New here? Start with [Why Hypermedia](./why.md), then read [the Hypermedia protocol](./protocol.md).

# The ideas

The protocol is a small set of ideas. Each idea has its own page, and [the Hypermedia protocol](./protocol.md) walks through them in order.

- **A key is an account, and an account is a space.** [Identity](./protocol/identity.md) explains keys and accounts. [Spaces and paths](./protocol/spaces.md) explains where documents live.
- **Everything is a signed blob.** A blob is one piece of data that never changes. [Blobs](./protocol/blobs.md) covers the six kinds. [Integrity](./protocol/integrity.md) says what you can check yourself and what you must trust.
- **A document is a history of changes.** [Documents](./protocol/documents.md) are built from [changes](./change.md), and [refs](./ref.md) place them at an address. Their content is a tree of [blocks](./protocol/blocks.md).
- **A link can point at an exact version, block or range of text.** [URLs](./protocol/urls.md) shows how to write one. [Links and citations](./protocol/links-and-citations.md) covers backlinks and mentions.
- **One key gives access to another key.** [Permissions](./protocol/permissions.md) covers capabilities and roles. [Contacts](./protocol/contacts.md) covers following people and joining sites. [Privacy](./protocol/privacy.md) covers private content.
- **People talk about documents.** [Comments](./protocol/comments.md) are records in their author's space.
- **Content moves between peers.** [Network](./protocol/network.md) covers how computers find and copy content. [Sites](./protocol/sites.md) put a space on a web domain. [Files](./protocol/files.md) covers images and attachments.

[Why Hypermedia](./why.md) explains the reasons behind these ideas, for any reader.

# What you make with it

Some documents are more than text. Each kind has its own page.

- An [app](./app.md) is a document that holds tools, pages and triggers.
- A [tool](./tool.md) is a function that an [app environment](./software/app-environment.md) runs for an app or an agent. An app environment is the server that runs them.
- A [page](./page.md) is a document that opens as a small web page in a sandbox.
- A [trigger](./trigger.md) starts a tool or an agent when something happens.
- An [agent](./agent.md) is a language model with a memory, tools and its own keys. It reads and writes Hypermedia like any other participant.

[Hypermedia Schemas](./schema.md) is the type system behind all of them. The [catalogue of types](./schema/types.md) lists every type on this site. [Examples](./example.md) shows schemas and [typed documents](./schema/typed-documents.md), which are documents that follow a schema.

# Doing things

- **Build on Hypermedia.** [Building on Hypermedia](./build.md) has the references (the [Seed API](./build/web-api.md), the [SDK](./build/sdk.md), the [CLI](./build/cli.md)) and a guide for each task.
- **Run it.** [Running Seed](./operate.md) covers a site, a node and an app environment.
- **Change it.** [Working on Seed](./contribute.md) is for people who change the Seed code.
- **Find a program.** [The Seed software](./software.md) has one page for each program.

# For agents <!-- id:GB3nY3rU -->

These pages are written for agents as well as people. Most concept pages have a "Working with …" section near the end. It shows how to do the thing in the Seed app, the CLI, the SDK, the Seed API and from an agent. If you are an agent, start with [Using Seed from your own agent](./build/agents.md), the [CLI](./build/cli.md) and the [Seed API](./build/web-api.md). Two requests help most. `/api/Resource` on any Seed site returns a document as JSON. Adding `.md` to a page URL returns the page as markdown. <!-- id:myu_MyLi -->

# Where the source lives <!-- id:-YxSfaki -->

These pages are markdown files in the folder `hypermedia/` of the public Seed repository, [github.com/seed-hypermedia/seed](https://github.com/seed-hypermedia/seed). A sync keeps that folder and this Hypermedia space the same, and [Publish a folder](./build/publish-a-folder.md) explains how. To correct a page, edit the markdown and open a pull request. To preview or edit a page in the Seed app, run the local dev loop (`./dev hm-sync`), which writes your edits back to the markdown. Never edit the published pages on hyper.media directly. See [Editing these docs](./contribute/editing-these-docs.md). <!-- id:-H2vfuhJ -->

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

<./authority.md> <!-- id:BTkNe2g7 type:Embed attrs:{"view":"Card"} -->

<./role.md> <!-- id:AfmitHEx type:Embed attrs:{"view":"Card"} -->

<./visibility.md> <!-- id:eHK9gwvg type:Embed attrs:{"view":"Card"} -->

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

<./link.md> <!-- id:8mi0zkbc type:Embed attrs:{"view":"Card"} -->

<./account.md> <!-- id:4T0MZZee type:Embed attrs:{"view":"Card"} -->

<./principal.md> <!-- id:rblSeWul type:Embed attrs:{"view":"Card"} -->

<./signature.md> <!-- id:1BinpM6h type:Embed attrs:{"view":"Card"} -->

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
