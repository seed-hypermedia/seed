---
name: The Hypermedia Protocol
summary: This page gives the words Hypermedia uses, shows how keys, blobs, documents, URLs, sites and the network fit together, and lists the concept pages in reading order.
---
Hypermedia is a protocol for publishing documents that their authors own. An author is a cryptographic key. The author signs everything they publish, and each piece of data is named by its own hash. Any computer that holds the data can serve it, check it, and keep it after the original site is gone. <!-- id:rG0eIdhD -->

Seed is the software that runs the protocol. It has a [daemon](./software/daemon.md) that stores and syncs the data, the [Seed app](./software/desktop.md), a [web app](./software/web.md), a command-line tool called the [CLI](./build/cli.md), and [agents](./agent.md).

This page gives the words and shows how the things fit together. Then it lists the concept pages in reading order. It has no reference tables. Each concept page explains one idea, and each type page lists the fields of one type.

# A note on words <!-- id:wVDNHkRN -->

Three words come first. A **[document](./protocol/documents.md)** is a page. An **[account](./protocol/identity.md)** is a key used as an identity. A **[space](./protocol/spaces.md)** is all the documents that key owns: the same key, seen from the other side. <!-- id:EAr97Lgd -->

Three more words appear often:

- A **[site](./protocol/sites.md)** is a space published at a web domain.
- A **[resource](./glossary.md)** is anything that can change and is rebuilt from [blobs](./protocol/blobs.md), which cannot change. The API uses this word. A document is one kind of resource: each edit is a small change, and the changes are applied in order.
- A **snapshot blob** is the other kind of resource: an edit replaces the whole value. [Comments](./protocol/comments.md), [contacts](./protocol/contacts.md) and [profiles](./profile.md) are snapshot blobs.

# The core nouns

- **Key.** A public key, written `z6Mk…`, is the only root of identity. Inside a blob it is called a [principal](./principal.md).
- **Account and space.** One key seen two ways. The [account](./protocol/identity.md) is the identity that signs. The [space](./protocol/spaces.md) is the set of addresses `hm://<key>/<path>` that the key owns.
- **Device key.** A separate key that names one running [daemon](./software/daemon.md) on the [network](./protocol/network.md). It never signs content.
- **Blob.** A value that never changes, named by its [CID](./cid.md), which is a hash of its bytes. A structured [blob](./protocol/blobs.md) carries four signed fields: `type`, `signer`, `sig` and `ts`. There are six signed types: [Change](./change.md), [Ref](./ref.md), [Comment](./comment.md), [Capability](./capability.md), [Contact](./contact.md) and [Profile](./profile.md). [Files](./protocol/files.md) are unsigned blobs.
- **Resource.** A [document](./protocol/documents.md), or a snapshot record: a comment, a contact or a profile.
- **Document.** Changes, replayed in order, give the document's [metadata](./metadata.md) and its tree of [blocks](./protocol/blocks.md). Refs place the document at a path in a space.
- **URL.** [`hm://<account>/<path>?v=<version>#<block>`](./protocol/urls.md) names a space, a path, an exact version, and a block or a range of text.
- **Citation.** The record a node makes for every `hm://` link it sees. [Citations](./protocol/links-and-citations.md) give every resource its backlinks: the list of what links to it.
- **File.** IPFS data that a block, a metadata key or a profile links as `ipfs://<cid>`.
- **Visibility.** Public or `Private`. It is set on Refs and comments. Changes and files take it from whatever links to them. See [Privacy](./protocol/privacy.md).
- **Site.** A space published at a web domain. See [Sites](./protocol/sites.md).
- **Network.** Peers, which are running daemons, compare the blobs they hold and fetch what they lack. See [Network](./protocol/network.md).

# Reading order

Read from the top. Each page builds on the ones above it.

- **[Identity](./protocol/identity.md).** Read this first. An account is a key pair, and profiles, devices and sessions are statements signed with it. <!-- id:Mf00EicU -->
- **[Signed blobs](./protocol/blobs.md).** How every piece of data is encoded, named by its hash and signed, and the six blob types. <!-- id:2Ry0A-ZX -->
- **[Documents](./protocol/documents.md).** How Changes build a document, how a Ref places it at an address, and what versions, branches, deletion and redirects are. <!-- id:qTY_V2qt -->
- **[Spaces and paths](./protocol/spaces.md).** Where documents live: the space, the path, the home document and directories.
- **[Blocks](./protocol/blocks.md).** The content inside a document: the block tree, annotations, embeds, [query blocks](./block/query.md) and tables. <!-- id:yrYPQFdn -->
- **[URLs](./protocol/urls.md).** How to write an `hm://` address and how it maps to a web address. <!-- id:cM62uew3 -->
- **[Links and citations](./protocol/links-and-citations.md).** How links become citations, backlinks and mentions.
- **[Permissions](./protocol/permissions.md).** Who may write into a space: capabilities, the two roles and the exact rule. <!-- id:r6Ly3pmR -->
- **[Contacts](./protocol/contacts.md).** The public address book, following a person and joining a site.
- **[Comments](./protocol/comments.md).** Signed notes on one version of a document, with threads, and comments on a block or a range of text. <!-- id:Pe35wo8V -->
- **[Privacy](./protocol/privacy.md).** What a private Ref or comment means and who may read it. <!-- id:AVBbn3tB -->
- **[Integrity](./protocol/integrity.md).** What a reader can verify alone, and what a reader must trust. <!-- id:z1vKx7xD -->
- **[Network](./protocol/network.md).** How peers find each other and move blobs. <!-- id:V1UV7S3o -->
- **[Sites](./protocol/sites.md).** How a space becomes a website at a domain. <!-- id:l7_pNvCU -->
- **[Files](./protocol/files.md).** Images and attachments as IPFS data. <!-- id:1DYRpHhZ -->

# Concept pages and type pages

The pages above are concept pages. Each explains one idea in plain words. Each blob type and value type also has a type page at the root of this site, such as [blob](./blob.md), [change](./change.md), [ref](./ref.md), [document](./document.md), [block](./block.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md) and [principal](./principal.md). A type page lists the fields of that type and carries its formal schema. A concept page links to the type page for the fields.

# Building on it <!-- id:1ieE_YmO -->

Start at [Building on Hypermedia](./build.md) and [Getting started](./build/getting-started.md). There are three levels: <!-- id:Okhmbnos -->

- **Most programs** use the [Seed API](./build/web-api.md), which every site serves at `/api/<request name>`, such as `/api/Resource`. The [SDK](./build/sdk.md), `@seed-hypermedia/client`, wraps it for TypeScript.
- **Scripts** use the [CLI](./build/cli.md). An agent outside Seed uses it too: see [Using Seed from your own agent](./build/agents.md).
- **Deep integration** uses the daemon's [gRPC API](./build/grpc.md) and the peer-to-peer [network protocol](./protocol/network.md).

[Agents](./agent.md) inside Seed read and write all of the above through the same API, with keys their owner gives them.

# See also <!-- id:r4IaGuga -->

- [Why Hypermedia](./why.md) for the reasons behind the protocol. <!-- id:ObNGf8Fh -->
- [Glossary](./glossary.md) for every term in one place. <!-- id:lQto8dx- -->
- [Building on Hypermedia](./build.md) for guides and APIs. <!-- id:OMjhUehm -->
- [Seed Agents](./agent.md) for agents that run inside Seed. <!-- id:UjXhbUbP -->

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
