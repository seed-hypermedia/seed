---
name: The Hypermedia Protocol
summary: A layered tour of how Hypermedia works, from keys and signed blobs up through documents, URLs, permissions, comments, the peer-to-peer network, sites and the APIs, with a link into each layer's page.
---
Hypermedia is a protocol for publishing documents that belong to their authors rather than to a server. An author is a cryptographic key; everything the author publishes is signed and named by its own hash; and any computer that holds the data can serve it, verify it, and keep it after the original site is gone. Seed is the software that implements the protocol: a daemon, a desktop app, a web server, a command line, and a hosted agent runtime.

This page walks the layers from the bottom up. Each layer has its own page with the precise model and a "Working with it" section covering the Seed app, the CLI, the SDK, the web API and agents.

# A note on words

A **resource** is the umbrella term for anything mutable that is reconstructed from immutable blobs; it is the word the API uses. In these pages we say **document** for the change-based kind, where edits are small deltas applied in order, and **snapshot blobs** for comments, contacts and profiles, where an edit replaces the whole value. An **account** is a key used as an identity; a **space** is the namespace of documents that key owns (the same key, seen from the other side); a **site** is a space published at a web domain.

# The layers

- **[Identity](./protocol/identity.md).** There is no account database. An account is an Ed25519 key pair; its public key, written as a `z6Mk…` string, is its name and the root of its space. A profile blob gives it a display name and avatar, and a capability can let a second key (a browser session, a device, an agent) act for it.

- **[Signed blobs](./protocol/blobs.md).** Every piece of data is a DAG-CBOR value with a `type`, a `signer`, a `sig` and a `ts`, named by its CID. Signing zeroes the signature field, encodes, signs, and fills it back in. The daemon hashes with BLAKE2b and the clients with SHA-256, and the rule that follows is that a blob referenced by CID must be uploaded under the CID the referrer used.

- **[Documents](./protocol/documents.md).** A document is a graph of Change blobs, each pointing at the changes it builds on, replayed with two small CRDTs into metadata and a block tree. A Ref blob asserts which heads an address currently shows; a version is the sorted set of head CIDs; generations, tombstones and redirects manage the life of an address; branching is publishing your own Ref.

- **[Blocks](./protocol/blocks.md).** Inside a document, content is a tree of blocks with ids, types, text, annotations and attributes: paragraphs and headings, images and files, embeds of other documents, query blocks that list documents, tables and more. Metadata keys are typed by [Hypermedia Schemas](./schema.md).

- **[URLs](./protocol/urls.md).** `hm://<uid>/<path>?v=<version>#<block>[start:end]` names a space, a path, an exact version and a range of text. Every Seed web server serves the same documents at `https://<host>/hm/<uid>/<path>` and at pretty site paths, and the two forms convert exactly.

- **[Permissions](./protocol/permissions.md).** A space owner grants a Capability blob to another key with a role (WRITER or AGENT) and a path scope; a Ref is honoured only when its signer is the owner or holds a matching grant. Capabilities do not expire and cannot be revoked yet. Contacts record who follows whom; the wider web of trust is a direction, not a feature.

- **[Comments](./protocol/comments.md).** A comment is a snapshot blob in its author's space that targets a document and version, threads by reply, and can attach to a block or a range. Anyone can comment on anything; the daemon indexes every link and embed as a citation, so backlinks come for free.

- **[Privacy](./protocol/privacy.md).** Refs and comments carry a visibility; changes and files inherit it. Private data is served only to the owner, its writers and its site. Private document creation is disabled in the daemon at the moment, so this layer is small and evolving.

- **[Integrity](./protocol/integrity.md).** Content addressing, authorship, history and write authority are verified end to end. Timestamps, generation numbers, the mapping from a domain to a site and the local API are trusted, and this page says so plainly.

- **[Network](./protocol/network.md).** Nodes are libp2p peers identified by a device key that is not an account key. Data moves by set reconciliation of blob lists followed by Bitswap fetches, driven by subscriptions and by explicit discovery of an address; there is no DHT and no gossip today. Bootstrap gateways introduce peers.

- **[Sites](./protocol/sites.md).** A site is a space whose home document names a `siteUrl`, served by a Seed web server that has registered that account. `https://<host>/hm/api/config` tells the world which account and peer stand behind a domain.

- **[Files](./protocol/files.md).** Images and attachments are ordinary IPFS UnixFS data linked from blocks as `ipfs://<cid>` and served at `/ipfs/<cid>`; a file becomes public once a public blob links to it.

# Building on it

The web server's Seed API (`/api/<Key>`) and the `@seed-hypermedia/client` SDK are the canonical entry points; the CLI and agent skills are for scripting; the daemon's gRPC and the libp2p protocol are for deep integration. Start at [Building on Hypermedia](./build.md) and [Getting started](./build/getting-started.md), and read [Seed Agents](./agent.md) for the hosted agent runtime that reads and writes all of the above through the same API with delegated keys.

# Where this is going

The protocol described in these pages is what ships as of September 2026. The team is exploring a revised blob layout, capability revocation and an editor role, a second phase of private documents, and schemas as first-class resources; those directions are collected, dated, in [Roadmap](./protocol/roadmap.md) and are not part of the current specification.

# See also

- [Why Hypermedia](./why.md) for the motivation.
- [Glossary](./glossary.md) for every term in one place.
- The schema library at the root of this site: [blob](./blob.md), [change](./change.md), [ref](./ref.md), [document](./document.md), [block](./block.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md).
