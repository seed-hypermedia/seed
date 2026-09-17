---
name: Integrity
summary: What Hypermedia verifies cryptographically end to end (content addressing, authorship, history, write authority) and what it trusts (timestamps, comments, servers, the local daemon API), so you know which guarantees you can build on.
---
When you read a Hypermedia [document](./documents.md), you read bytes that came from somewhere: a [site](./sites.md), a [peer](./network.md), a cache. Integrity covers what you can check about those bytes yourself, without trusting whoever handed them to you. You can verify some things from the content alone. Other things are trusted, and you need to know which. <!-- id:1IPrLiS2 -->

This page lists both, as the [daemon](../apps/daemon.md) implements them today, and then the mitigations for the trusted parts. <!-- id:iirFiDsg -->

# What is verified end to end <!-- id:C8kii1Jw -->

**Content addressing.** Every [blob](../blob.md) is named by the hash of its bytes, a [CID](../cid.md). When a blob arrives with a CID attached, whether over the daemon's store RPC, over `POST /ipfs/<cid>`, or through [Bitswap](https://specs.ipfs.tech/bitswap-protocol/), the daemon recomputes the hash and refuses a mismatch. So a link to a CID is a link to exactly one sequence of bytes, forever, on any node. This makes [the end of broken links](../why/broken-links.md) possible. <!-- id:hse31DyN -->

**Authorship.** Every structural blob (Change, Ref, Comment, Capability, Contact, Profile) carries the signer's public [key](./identity.md) and a signature, [Ed25519](https://ed25519.cr.yp.to/) or ECDSA P-256 depending on the key, over its canonical [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) encoding with the signature field zeroed. The daemon verifies the signature before interpreting the blob. A blob with a bad signature is at most stored as opaque bytes, and is never indexed. So you can re-check "signed by `z6Mk…`" anywhere, without asking a server. See [Blobs](./blobs.md) for the exact signing rule. <!-- id:6iqmmOty -->

**History.** A document version is a set of [Change](../change.md) CIDs. Each Change links its dependencies and its genesis by CID, so a version pins its entire history as a [Merkle DAG](https://docs.ipfs.tech/concepts/merkle-dag/). Changing anything in the past changes every CID after it. Replay rejects changes whose declared depth or time runs backwards relative to their dependencies. It also rejects a Ref whose Changes do not share a genesis. See [Documents](./documents.md). <!-- id:UvL709j_ -->

**Write authority.** The daemon indexes only [Refs](../ref.md) signed by the space owner or by a key holding a matching owner-signed [capability](../capability.md). Refs and capabilities are both signed and content-addressed. So a third party can re-verify the whole chain offline: this Ref, this capability, this owner. The rule is in [Permissions](./permissions.md). <!-- id:B-ct-P6Z -->

Together, these let a reader who holds a version's CIDs verify three things with no network and no trusted party: who wrote each change, in what order, and that the person who published this version was allowed to. <!-- id:bkBhN46R -->

# What is trusted <!-- id:m_bRAU2K -->

**Timestamps are self-declared.** Nothing checks a blob's `ts` against real time when it is ingested. Ordering inside a document is causal (dependencies). But last-writer-wins resolution of metadata, comment ordering, and [generation](./documents.md) numbers all read declared times, so a legitimate signer can back-date or forward-date. A capability issued after a Ref authorizes it retroactively. If you need a trustworthy time, anchor the CID externally. The team has discussed OpenTimestamps, but nothing is built. <!-- id:rZDXk-t2 -->

**Nothing checks authorization on Changes and comments.** The daemon stores any key's Change. The Change becomes part of a document only through an authorized Ref. Any key can attach a public [comment](./comments.md) to any document. No layer checks it: not the index, not the API. Moderation is left to clients and sites. <!-- id:TABAN6Hu -->

**Capabilities never expire and cannot be revoked.** A grant is valid on every node that has it, forever. See [Permissions](./permissions.md) for the mitigation: grant narrowly, to keys you control. <!-- id:Ee5-riN- -->

**Peer identity is separate from account identity.** A peer proves it holds an account only when it wants [private](./privacy.md) data, with a signed ephemeral capability fresh within one minute. Public data needs no peer-level trust, because public blobs verify themselves. <!-- id:K1wjcasf -->

**Site trust is DNS and HTTPS trust.** The peer that `https://<siteUrl>/hm/api/config` reports is granted the space's private blobs, because the home document says that host is the site. Whoever controls the domain and its certificate controls that trust. A space owner who points `siteUrl` at a hostile host hands that host their private content. <!-- id:lZ4F8fRe -->

**The local daemon API has no authentication.** The gRPC port and the HTTP port accept any caller who can reach them, with CORS open to every origin. Any such caller can list keys, sign with any stored key, export keys, store blobs, create Refs and capabilities with any registered key, or force a reindex. Write RPCs check whether the key may write. They never check the caller. The daemon is designed to be reached only from localhost or behind a firewall. Hosted sites run with `-public-only`, which hides private content from unauthenticated HTTP requests but does not disable writes. <!-- id:GCxyZk8- -->

**Bearer tokens are symmetric and daemon-local.** A token is sealed with a random per-daemon secret and lasts thirty days. The only way to invalidate it is to rotate that secret. Its only tie to state is that the daemon must still know the principal. It widens reads on public-only nodes and never authorizes a write. <!-- id:O-MCJker -->

**Two CIDs for the same bytes.** The daemon hashes with BLAKE2b by default and the [SDK](../build/sdk.md) hashes with SHA-256. Both are valid CIDs of the same content. The daemon deduplicates by multihash, so a Ref naming the SHA-256 head and another naming the BLAKE2b head of identical bytes are two different documents. Always pass explicit CIDs for blobs that other blobs reference. See [Blobs](./blobs.md). <!-- id:NvliI770 -->

# Mitigations <!-- id:we0FdOvO -->

<!-- id:9KFP54wS -->
| Trusted part <!-- col:_8gmy-bk --> | What to do about it <!-- col:o8c578o6 --> <!-- id:C8M3OtL5 --> |
| --- | --- |
| open local API | bind to localhost, firewall the ports, run hosted nodes with `-public-only`, never expose a desktop daemon; see [Self-hosting](../build/self-hosting.md) <!-- id:va4uXiFL --> |
| unauthenticated comments | filter by author or by [contacts](./permissions.md) in the client; site-level comment gating is planned <!-- id:_dNSAAI5 --> |
| eternal capabilities | grant WRITER on a path to a key you control; give bots and servers their own keys; treat a lost delegate key as permanent <!-- id:E6SkAwMy --> |
| self-declared time | treat `ts` as the author's claim; anchor externally if it matters <!-- id:hMxG5DQa --> |
| site trust | keep control of the domain and certificate; the site's account and signer are visible in `/hm/api/config` <!-- id:1OYen0iH --> |
| dual CIDs | always pass a `cid` with every blob you publish that another blob links to <!-- id:I5V7emo6 --> |

# Compared with ActivityPub <!-- id:ZqN7xelS -->

Federated social protocols such as ActivityPub verify a message at the transport. The receiving server checks an HTTP signature from the sending server, then stores the content as its own copy under its own authority. If that server goes away or changes its mind, the content and its provenance go with it. Hypermedia puts the signature on the content. Every blob carries its author's signature and its own hash. Any copy, on any node, years later, still proves who wrote it and that nothing changed. Servers are replicas with no authority over the content. The longer argument, and the trade-offs, are in [Why signed content](../why/signed-content.md). <!-- id:VseXAp7H -->

# Working with integrity <!-- id:rVRtYCG3 -->

## In the Seed app <!-- id:lYAETstD -->

The [Seed app](../apps/desktop.md) verifies signatures and CIDs on everything it indexes through the local daemon. It shows the author of each change in a document's history, and stashes unauthorized Refs. Verification is always on, and there is no switch for it. <!-- id:8UiG6u0s -->

## CLI <!-- id:S98KMjE7 -->

```sh <!-- id:XhZyWaRJ -->
seed-cli blob get <cid>                 # fetch the raw signed blob
seed-cli blob verify <cid>              # check the signature of a stored blob
seed-cli document changes hm://…        # the change DAG with signers and times
seed-cli document cid hm://…            # the CIDs behind a version
```

See [the CLI guide](../build/cli.md).

## SDK <!-- id:KgEm50AD -->

`blobs.verify` checks a signature against the embedded signer. `signed-blob` handles the canonical encoding and the zeroed-signature rule so your own blob types verify the same way. Compute CIDs with `multiformats` and pass them explicitly on publish. See [SDK](../build/sdk.md). <!-- id:5C7ht3P2 -->

## Web API <!-- id:JvJy5vBz -->

On the [Seed API](../build/web-api.md), `GET /api/GetCID?cid=…` returns a blob as DAG-JSON for inspection. `GET /api/ListChanges?targetId=…` walks a document's history with signers. `/ipfs/<cid>` on a site serves raw bytes whose hash you can recompute. On the read side you trust the site only to be available. <!-- id:wVT5ffrF -->

## Agents <!-- id:Fjnb0lul -->

[Seed Agents](../agent.md) read through the same site APIs and can inspect a blob with [`read`](../agent/read.md) on an `ipfs://<cid>` address. When an agent publishes, the agent server signs with the agent's own key. For delegated writes it attaches the capability CID so a receiving node can re-verify authority. The runtime's own signed envelope uses the same blob signing scheme with a time window; see [Signed API](../agent/signed-api.md). <!-- id:V4Dws-X9 -->

# See also <!-- id:4Wlg7DZR -->

- [Blobs](./blobs.md), [Documents](./documents.md), [Identity](./identity.md), [Permissions](./permissions.md), [Privacy](./privacy.md), [Network](./network.md) <!-- id:5FHwtieD -->
- [CID](../cid.md), [Signature](../signature.md), [Timestamp](../timestamp.md) <!-- id:b4zleV6n -->
- [Why signed content](../why/signed-content.md), [The end of broken links](../why/broken-links.md) <!-- id:EDttAXTg -->
- [Glossary](../glossary.md) <!-- id:--5qxReP -->
