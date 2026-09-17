---
name: The Hypermedia Protocol
summary: A tour of the layers of Hypermedia, from keys and signed blobs up through documents, URLs, permissions, comments, the peer-to-peer network, sites and the APIs, with a link to each layer's page.
---
Hypermedia is a protocol for publishing documents that their authors own. An author is a cryptographic key. Everything the author publishes is signed and named by its own hash. Any computer that holds the data can serve it, verify it, and keep it after the original site is gone. Seed is the software that implements the protocol: a [daemon](./apps/daemon.md), a [desktop app](./apps/desktop.md), a [web server](./apps/web.md), a [command line](./build/cli.md), and a hosted agent runtime, [Seed Agents](./agent.md).

This page walks the layers from the bottom up. Each layer has its own page with the exact model and a "Working with it" section for the Seed app, the CLI, the SDK, the web API and agents.

# A note on words

A **[resource](./glossary.md)** is the umbrella term for anything mutable that is rebuilt from immutable [blobs](./protocol/blobs.md). The API uses this word. These pages say **[document](./protocol/documents.md)** for the change-based kind, where edits are small deltas applied in order. They say **snapshot blobs** for [comments](./protocol/comments.md), [contacts](./protocol/permissions.md) and [profiles](./protocol/identity.md), where an edit replaces the whole value. An **account** is a key used as an identity. A **space** is the namespace of documents that key owns: the same key, seen from the other side. A **[site](./protocol/sites.md)** is a space published at a web domain.

# The layers

- **[Identity](./protocol/identity.md).** There is no account database. An account is an Ed25519 key pair. Its public key, written as a `z6Mk…` string, is its name and the root of its space. A [Profile](./profile.md) blob gives it a display name and avatar. A [capability](./protocol/permissions.md) can let a second key (a browser session, a device, an agent) act for it.

- **[Signed blobs](./protocol/blobs.md).** Every piece of data is a [DAG-CBOR](./schema/dag-cbor.md) value with a `type`, a `signer`, a `sig` and a `ts`, named by its [CID](./cid.md). Signing zeroes the signature field, encodes, signs, and fills the signature back in. The daemon hashes with BLAKE2b and the clients hash with SHA-256. So a blob referenced by CID must be uploaded under the CID the referrer used.

- **[Documents](./protocol/documents.md).** A document is a graph of [Change](./change.md) blobs. Each Change points at the changes it builds on. Replaying them with two small CRDTs produces metadata and a [block](./protocol/blocks.md) tree. A [Ref](./ref.md) blob states which heads an address shows now. A version is the sorted set of head CIDs. Generations, tombstones and redirects manage the life of an address. To branch a document, you publish your own Ref.

- **[Blocks](./protocol/blocks.md).** Inside a document, content is a tree of blocks with ids, types, text, annotations and attributes. Block types include paragraphs and headings, images and [files](./protocol/files.md), embeds of other documents, [query blocks](./query.md) that list documents, tables and more. [Hypermedia Schemas](./schema.md) define the types of [metadata](./metadata.md) keys.

- **[URLs](./protocol/urls.md).** `hm://<uid>/<path>?v=<version>#<block>[start:end]` names a space, a path, an exact version and a range of text. Every Seed web server serves the same documents at `https://<host>/hm/<uid>/<path>` and at pretty [site](./protocol/sites.md) paths. The two forms convert exactly.

- **[Permissions](./protocol/permissions.md).** A space owner grants a [Capability](./capability.md) blob to another key with a [role](./role.md) (WRITER or AGENT) and a path scope. A node honours a Ref only when its signer is the owner or holds a matching grant. Capabilities do not expire and cannot be revoked yet. [Contacts](./contact.md) record who follows whom. A wider web of trust is not built.

- **[Comments](./protocol/comments.md).** A comment is a snapshot blob in its author's space. It targets a document and version, threads by reply, and can attach to a block or a range. Anyone can comment on anything. The daemon indexes every link and embed as a citation, so every document gets backlinks.

- **[Privacy](./protocol/privacy.md).** Refs and comments carry a [visibility](./visibility.md). Changes and files inherit it. Private data is served only to the owner, its writers and its site. The daemon has private document creation turned off for now.

- **[Integrity](./protocol/integrity.md).** Content addressing, authorship, history and write authority are verified end to end. Timestamps, generation numbers, the mapping from a domain to a site, and the local API are trusted. The page lists each one.

- **[Network](./protocol/network.md).** Nodes are libp2p peers identified by a device key that is not an account key. Data moves by set reconciliation of blob lists, then Bitswap fetches. Subscriptions and explicit discovery of an address drive this. There is no DHT and no gossip today. Bootstrap [gateways](./protocol/sites.md) introduce peers.

- **[Sites](./protocol/sites.md).** A site is a space whose home document names a `siteUrl`. A Seed web server that has registered that account serves it. `https://<host>/hm/api/config` tells the world which account and peer stand behind a domain.

- **[Files](./protocol/files.md).** Images and attachments are ordinary IPFS UnixFS data. Blocks link them as `ipfs://<cid>`, and nodes serve them at `/ipfs/<cid>`. A file becomes public once a public blob links to it.

# Building on it

The web server's [Seed API](./build/web-api.md) (`/api/<Key>`) and the [`@seed-hypermedia/client` SDK](./build/sdk.md) are the main entry points. The [CLI](./build/cli.md) and [agent skills](./build/agents.md) are for scripting. The daemon's [gRPC API](./build/grpc.md) and the libp2p [network protocol](./protocol/network.md) are for deep integration. Start at [Building on Hypermedia](./build.md) and [Getting started](./build/getting-started.md). [Seed Agents](./agent.md) is the hosted agent runtime: it reads and writes all of the above through the same API with delegated keys.

# Where this is going

These pages describe the protocol that ships as of September 2026. The team is exploring a revised blob layout, capability revocation and an editor role, a second phase of private documents, and schemas as resources of their own. [Roadmap](./protocol/roadmap.md) collects those directions with dates. They are not part of the current specification.

# See also

- [Why Hypermedia](./why.md) for the motivation.
- [Glossary](./glossary.md) for every term in one place.
- [Building on Hypermedia](./build.md) for guides and APIs.
- [Seed Agents](./agent.md) for the hosted agent runtime.
- The schema library at the root of this site: [blob](./blob.md), [change](./change.md), [ref](./ref.md), [document](./document.md), [block](./block.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md).
