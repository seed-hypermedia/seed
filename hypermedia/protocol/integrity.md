---
name: Integrity
summary: What Hypermedia verifies cryptographically end to end (content addressing, authorship, history, write authority) and what it merely trusts (timestamps, comments, servers, the local daemon API), so you know which guarantees you can build on.
---
When you read a Hypermedia document you are reading bytes that arrived from somewhere: a site, a peer, a cache. Integrity is the question of what you can check for yourself about those bytes, without trusting whoever handed them to you. Some things are verifiable from the content alone. Others are trusted, and it matters to know which.

This page lists both, as the daemon implements them today, and ends with the mitigations for the trusted parts.

# What is verified end to end

**Content addressing.** Every [blob](../blob.md) is named by the hash of its bytes, a [CID](../cid.md). When a blob arrives with a CID attached, whether over the daemon's store RPC, over `POST /ipfs/<cid>`, or through [Bitswap](https://specs.ipfs.tech/bitswap-protocol/), the daemon recomputes the hash and refuses a mismatch. A link to a CID is therefore a link to exactly one sequence of bytes, forever, on any node. This is what makes [the end of broken links](../why/broken-links.md) possible.

**Authorship.** Every structural blob (Change, Ref, Comment, Capability, Contact, Profile) carries the signer's public key and an [Ed25519](https://ed25519.cr.yp.to/) signature over its canonical [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) encoding with the signature field zeroed. The daemon verifies the signature before interpreting the blob; a blob with a bad signature is stored at most as opaque bytes and never indexed. So "signed by `z6Mk…`" is a fact you can re-check anywhere, not a claim a server makes. See [Blobs](./blobs.md) for the exact signing rule.

**History.** A document version is a set of [Change](../change.md) CIDs. Each Change links its dependencies and its genesis by CID, so a version pins its entire history as a [Merkle DAG](https://docs.ipfs.tech/concepts/merkle-dag/): nothing in the past can be altered without changing every CID after it. Replay rejects changes whose declared depth or time runs backwards relative to their dependencies, and a Ref whose Changes do not share a genesis. See [Documents](./documents.md).

**Write authority.** Only [Refs](../ref.md) signed by the space owner, or by a key holding a matching owner-signed [capability](../capability.md), are indexed. Refs and capabilities are both signed and content-addressed, so a third party can re-verify the whole chain offline: this Ref, this capability, this owner. The rule is in [Permissions](./permissions.md).

Put together, a reader who holds a version's CIDs can verify, with no network and no trusted party, who wrote each change, in what order, and that the person who published this version was allowed to.

# What is trusted, not verified

**Timestamps are self-declared.** Nothing checks a blob's `ts` against real time when it is ingested. Ordering inside a document is causal (dependencies), but last-writer-wins resolution of metadata, comment ordering, and generation numbers all read declared times, so a legitimate signer can back-date or forward-date. A capability issued after a Ref retroactively authorizes it. If you need a trustworthy time, anchor the CID externally; the team has discussed OpenTimestamps but nothing is built.

**Changes and comments are not authorization-checked.** Any key's Change is stored; it only becomes part of a document through an authorized Ref. Any key can attach a public [comment](../comment.md) to any document, at every layer: no index check, no API check. Moderation is a client and site concern.

**Capabilities never expire and cannot be revoked.** A grant is valid on every node that has it, forever. See [Permissions](./permissions.md) for the mitigation: grant narrowly, to keys you control.

**Peer identity is not account identity.** A peer proves it holds an account only when it wants private data, with a signed ephemeral capability fresh within one minute. For public data there is no peer-level trust at all, and there does not need to be: public blobs verify themselves.

**Site trust is DNS and HTTPS trust.** The peer that `https://<siteUrl>/hm/api/config` reports is granted the space's private blobs, because the home document says that host is the site. Whoever controls the domain and its certificate controls that trust. A space owner who points `siteUrl` at a hostile host has handed that host their private content.

**The local daemon API has no authentication.** The gRPC port and the HTTP port accept any caller who can reach them, with CORS open to every origin. Any such caller can list keys, sign with any stored key, export keys, store blobs, create Refs and capabilities with any registered key, or force a reindex. Write RPCs ask "may this key write?", never "may this caller?". The daemon is designed to be reached only from localhost or behind a firewall, and hosted sites run with `-public-only`, which hides private content from unauthenticated HTTP requests but does not disable writes.

**Bearer tokens are symmetric and daemon-local.** A token is sealed with a random per-daemon secret, lasts thirty days, and can only be invalidated by rotating that secret. Its only binding to state is that the principal must still be known to the daemon. It widens reads on public-only nodes and never authorizes a write.

**Two CIDs for the same bytes.** The daemon hashes with BLAKE2b by default while the SDK hashes with SHA-256, and both are valid CIDs of the same content. The daemon deduplicates by multihash, so a Ref naming the SHA-256 head and another naming the BLAKE2b head of identical bytes are two different documents. Always pass explicit CIDs for blobs that other blobs reference. See [Blobs](./blobs.md).

# Mitigations

| Trusted part | What to do about it |
| --- | --- |
| open local API | bind to localhost, firewall the ports, run hosted nodes with `-public-only`, never expose a desktop daemon; see [Self-hosting](../build/self-hosting.md) |
| unauthenticated comments | filter by author or by contacts in the client; site-level comment gating is a planned feature |
| eternal capabilities | grant WRITER on a path to a key you control; give bots and servers their own keys; treat a lost delegate key as permanent |
| self-declared time | treat `ts` as the author's claim; anchor externally if it matters |
| site trust | keep control of the domain and certificate; the site's account and signer are visible in `/hm/api/config` |
| dual CIDs | always pass a `cid` with every blob you publish that another blob links to |

# Why this is not ActivityPub

Federated social protocols such as ActivityPub verify a message at the transport: the receiving server checks an HTTP signature from the sending server, then stores the content as its own copy under the server's authority. Take the server away, or change its mind, and the content and its provenance go with it. Hypermedia puts the signature on the content instead: every blob carries its author's signature and its own hash, so any copy, on any node, years later, still proves who wrote it and that nothing changed. Servers become replicas rather than authorities. The longer argument, and the trade-offs, are in [Why signed content](../why/signed-content.md).

# Working with integrity

## In the Seed app

The app verifies signatures and CIDs on everything it indexes through the local daemon, shows the author of each change in a document's history, and refuses unauthorized Refs by stashing them. There is no user-facing switch: verification is not optional.

## CLI

```sh
seed-cli blob get <cid>                 # fetch the raw signed blob
seed-cli blob verify <cid>              # check the signature of a stored blob
seed-cli document changes hm://…        # the change DAG with signers and times
seed-cli document cid hm://…            # the CIDs behind a version
```

## SDK

`blobs.verify` checks a signature against the embedded signer. `signed-blob` handles the canonical encoding and the zeroed-signature rule so your own blob types verify the same way. Compute CIDs with `multiformats` and pass them explicitly on publish. See [SDK](../build/sdk.md).

## Web API

`GET /api/GetCID?cid=…` returns a blob as DAG-JSON for inspection, `GET /api/ListChanges?targetId=…` walks a document's history with signers, and `/ipfs/<cid>` on a site serves raw bytes whose hash you can recompute. Nothing on the read side requires trust in the site beyond availability.

## Agents

Seed Agents read through the same site APIs and can inspect a blob with `read` on an `ipfs://<cid>` address. When an agent publishes, the agent server signs with the agent's own key and, for delegated writes, attaches the capability CID so a receiving node can re-verify authority. The runtime's own signed envelope uses the same blob signing scheme with a time window; see [Signed API](../agent/signed-api.md).

# See also

- [Blobs](./blobs.md), [Documents](./documents.md), [Identity](./identity.md), [Permissions](./permissions.md), [Privacy](./privacy.md), [Network](./network.md)
- [CID](../cid.md), [Signature](../signature.md), [Timestamp](../timestamp.md)
- [Why signed content](../why/signed-content.md), [The end of broken links](../why/broken-links.md)
- [Glossary](../glossary.md)
