---
name: The Hypermedia Protocol
summary: The words Hypermedia uses, how its core things relate (keys, blobs, documents, URLs, sites and the network), and the order to read the concept pages in.
---
Hypermedia is a protocol for publishing documents that their authors own. An author is a cryptographic key. Everything the author publishes is signed and named by its own hash. Any computer that holds the data can serve it, verify it, and keep it after the original site is gone. Seed is the software that implements the protocol: a [daemon](./software/daemon.md), a [desktop app](./software/desktop.md), a [web server](./software/web.md), a [command line](./build/cli.md), and a hosted agent runtime, [Seed Agents](./agent.md). <!-- id:rG0eIdhD -->

This page states the vocabulary and how the things relate, then lists the concept pages in reading order. It holds no reference tables: each concept page explains one idea, and each type page gives the fields of one type.

# A note on words <!-- id:wVDNHkRN -->

A **[resource](./glossary.md)** is the umbrella term for anything mutable that is rebuilt from immutable [blobs](./protocol/blobs.md). The API uses this word. These pages say **[document](./protocol/documents.md)** for the change-based kind, where edits are small deltas applied in order. They say **snapshot blobs** for [comments](./protocol/comments.md), [contacts](./protocol/contacts.md) and [profiles](./protocol/identity.md), where an edit replaces the whole value. An **[account](./protocol/identity.md)** is a key used as an identity. A **[space](./protocol/spaces.md)** is the namespace of documents that key owns: the same key, seen from the other side. A **[site](./protocol/sites.md)** is a space published at a web domain. <!-- id:EAr97Lgd -->

# The core nouns

- **Key.** A public key, written `z6Mk…`, is the only root of identity. Inside a blob it is a [principal](./principal.md).
- **Account and space.** One key seen two ways. The [account](./protocol/identity.md) is the identity that signs. The [space](./protocol/spaces.md) is the namespace `hm://<key>/<path>` that the key owns.
- **Device key.** A separate key that names one running [daemon](./software/daemon.md) on the [network](./protocol/network.md). It never signs content.
- **Blob.** An immutable value named by its [CID](./cid.md). A structured [blob](./protocol/blobs.md) carries a signed envelope: `type`, `signer`, `sig` and `ts`. There are six signed types: [Change](./change.md), [Ref](./ref.md), [Comment](./comment.md), [Capability](./capability.md), [Contact](./contact.md) and [Profile](./profile.md). [Files](./protocol/files.md) are unsigned blobs.
- **Resource.** A [document](./protocol/documents.md), or a snapshot record: a comment, a contact or a profile.
- **Document.** Changes replayed into [metadata](./metadata.md) and a tree of [blocks](./protocol/blocks.md), and placed at a path in a space by Refs.
- **URL.** [`hm://<account>/<path>?v=<version>#<block>`](./protocol/urls.md) names a space, a path, an exact version, and a block or a range of text.
- **Citation.** The index record a node derives from every `hm://` link. [Citations](./protocol/links-and-citations.md) give every resource its backlinks.
- **File.** IPFS data that a block, a metadata key or a profile links as `ipfs://<cid>`.
- **Visibility.** Public or `Private`. It is set on Refs and comments, and Changes and files inherit it. See [Privacy](./protocol/privacy.md).
- **Site.** A space published at a web domain. See [Sites](./protocol/sites.md).
- **Network.** Peers that reconcile the blobs of a scope and fetch what they lack. See [Network](./protocol/network.md).

# Reading order

Read from the top. Each page builds on the ones above it.

- **[Identity](./protocol/identity.md).** Read first: an account is a key pair, and profiles, devices and sessions are statements signed with it. <!-- id:Mf00EicU -->
- **[Signed blobs](./protocol/blobs.md).** How every piece of data is encoded, named by its hash and signed, and the six blob types. <!-- id:2Ry0A-ZX -->
- **[Documents](./protocol/documents.md).** How Changes build a document, how a Ref places it at an address, and what versions, branches, deletion and redirects are. <!-- id:qTY_V2qt -->
- **[Spaces and paths](./protocol/spaces.md).** Where documents live: the space, the path, the home document and directories.
- **[Blocks](./protocol/blocks.md).** The content inside a document: the block tree, annotations, embeds, query blocks and tables. <!-- id:yrYPQFdn -->
- **[URLs](./protocol/urls.md).** The `hm://` grammar and how it maps to web addresses. <!-- id:cM62uew3 -->
- **[Links and citations](./protocol/links-and-citations.md).** How links become citations, backlinks and mentions.
- **[Permissions](./protocol/permissions.md).** Who may write into a space: capabilities, the two roles and the exact rule. <!-- id:r6Ly3pmR -->
- **[Contacts](./protocol/contacts.md).** The public address book, following a person and joining a site.
- **[Comments](./protocol/comments.md).** Signed notes on a document version, with threads and block and range comments. <!-- id:Pe35wo8V -->
- **[Privacy](./protocol/privacy.md).** What a private Ref or comment means and who may read it. <!-- id:AVBbn3tB -->
- **[Integrity](./protocol/integrity.md).** What a reader can verify alone, and what is trusted. <!-- id:z1vKx7xD -->
- **[Network](./protocol/network.md).** How peers find each other and move blobs. <!-- id:V1UV7S3o -->
- **[Sites](./protocol/sites.md).** How a space becomes a website at a domain. <!-- id:l7_pNvCU -->
- **[Files](./protocol/files.md).** Images and attachments as IPFS data. <!-- id:1DYRpHhZ -->

# Concept pages and type pages

The pages above are concept pages. They explain an idea in plain words. Each blob type and value type also has a type page at the root of this site, such as [blob](./blob.md), [change](./change.md), [ref](./ref.md), [document](./document.md), [block](./block.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md) and [principal](./principal.md). A type page is the reference for the fields of that type and carries its formal schema. A concept page links to the type page for the fields.

# Building on it <!-- id:1ieE_YmO -->

The web server's [Seed API](./build/web-api.md) (`/api/<Key>`) and the [`@seed-hypermedia/client` SDK](./build/sdk.md) are the main entry points. The [CLI](./build/cli.md) and [agent skills](./build/agents.md) are for scripting. The daemon's [gRPC API](./build/grpc.md) and the libp2p [network protocol](./protocol/network.md) are for deep integration. Start at [Building on Hypermedia](./build.md) and [Getting started](./build/getting-started.md). [Seed Agents](./agent.md) is the hosted agent runtime: it reads and writes all of the above through the same API with delegated keys. <!-- id:Okhmbnos -->

# See also <!-- id:r4IaGuga -->

- [Why Hypermedia](./why.md) for the motivation. <!-- id:ObNGf8Fh -->
- [Glossary](./glossary.md) for every term in one place. <!-- id:lQto8dx- -->
- [Building on Hypermedia](./build.md) for guides and APIs. <!-- id:OMjhUehm -->
- [Seed Agents](./agent.md) for the hosted agent runtime. <!-- id:UjXhbUbP -->

# The concept pages <!-- id:sERoTcI2 attrs:{"childrenType":"Grid","columnCount":3} -->

<./protocol/identity.md> <!-- id:yk1R1BrY type:Embed attrs:{"view":"Card"} -->

<./protocol/spaces.md> <!-- id:PwnDQ9mZ type:Embed attrs:{"view":"Card"} -->

<./protocol/blobs.md> <!-- id:Nwt5jnEa type:Embed attrs:{"view":"Card"} -->

<./protocol/documents.md> <!-- id:GqBOIYgV type:Embed attrs:{"view":"Card"} -->

<./protocol/blocks.md> <!-- id:Mtx5JGhF type:Embed attrs:{"view":"Card"} -->

<./protocol/urls.md> <!-- id:PP78EgZu type:Embed attrs:{"view":"Card"} -->

<./protocol/links-and-citations.md> <!-- id:r6Pus2gk type:Embed attrs:{"view":"Card"} -->

<./protocol/permissions.md> <!-- id:Kh3G7q1W type:Embed attrs:{"view":"Card"} -->

<./protocol/contacts.md> <!-- id:UWEnhpDg type:Embed attrs:{"view":"Card"} -->

<./protocol/comments.md> <!-- id:xCiios40 type:Embed attrs:{"view":"Card"} -->

<./protocol/privacy.md> <!-- id:RdFW0L9y type:Embed attrs:{"view":"Card"} -->

<./protocol/integrity.md> <!-- id:J6VSQpag type:Embed attrs:{"view":"Card"} -->

<./protocol/network.md> <!-- id:XAYk3kV5 type:Embed attrs:{"view":"Card"} -->

<./protocol/sites.md> <!-- id:KaKtv42U type:Embed attrs:{"view":"Card"} -->

<./protocol/files.md> <!-- id:J4SJgcHp type:Embed attrs:{"view":"Card"} -->
