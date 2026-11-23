---
name: Integrity
summary: This page lists what you can check yourself about Hypermedia content (the bytes, the author, the history, the right to publish) and what you have to trust (times, comments, servers, the local daemon API).
---
When you read a Hypermedia [document](./documents.md), the bytes came from somewhere: a [site](./sites.md), a [peer](./network.md) or a cache. **Integrity** is about what you can check in those bytes yourself, without trusting whoever gave them to you. Some things you can check from the content alone. Other things you have to trust. You need to know which is which. <!-- id:1IPrLiS2 -->

This page lists both, as the [daemon](../software/daemon.md) does them. Then it says what to do about the trusted parts. <!-- id:iirFiDsg -->

# What you can check <!-- id:C8kii1Jw -->

**The bytes.** The name of every [blob](./blobs.md) is the hash of its bytes, called a [CID](../cid.md). A blob can arrive with a CID over the daemon's store RPC, over `POST /ipfs/<cid>`, or through [Bitswap](https://specs.ipfs.tech/bitswap-protocol/). Each time, the daemon computes the hash again and refuses the blob if the hash does not match. So a link to a CID is a link to exactly one sequence of bytes, forever, on any node. This makes [the end of broken links](../why/broken-links.md) possible. <!-- id:hse31DyN -->

**The author.** Every signed blob (Change, Ref, Comment, Capability, Contact, [Profile](../profile.md)) carries the signer's public [key](./identity.md) and a [signature](../signature.md). The signature is [Ed25519](https://ed25519.cr.yp.to/) or ECDSA P-256, depending on the key. It covers the blob's [canonical](../schema/canonical-encoding.md) [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) encoding with the signature field set to zeros. The daemon checks the signature before it reads the blob's meaning. It stores a blob with a bad signature as plain bytes at most, and never indexes it. So you can check "signed by `z6Mk…`" again anywhere, without asking a server. See [Blobs](./blobs.md) for the exact signing rule. <!-- id:6iqmmOty -->

**The history.** A document version is a set of [Change](../change.md) CIDs. Each Change links by CID to the Changes it builds on and to its genesis, the first Change. So a version fixes its whole history, as a [Merkle DAG](https://docs.ipfs.tech/concepts/merkle-dag/). If anything in the past changes, every CID after it changes too. When the daemon rebuilds a document, it rejects a Change whose stated depth or time goes backwards compared with the Changes it builds on. It also rejects a Ref whose Changes do not share a genesis. See [Documents](./documents.md). <!-- id:UvL709j_ -->

**The right to publish.** The daemon indexes a [Ref](../ref.md) only if the owner of the [space](./spaces.md) signed it, or a key that holds a matching [capability](./permissions.md) signed by the owner. Refs and capabilities are both signed and named by their hash. So anyone can check the whole chain offline: this Ref, this capability, this owner. The rule is in [Permissions](./permissions.md). <!-- id:B-ct-P6Z -->

Together, these let a reader who holds a version's CIDs check three things, with no network and no trusted party: who wrote each change, in what order, and that the key that published this version was allowed to. <!-- id:bkBhN46R -->

# What you have to trust <!-- id:m_bRAU2K -->

**The signer states the time.** Nothing compares a blob's `ts`, its [timestamp](../timestamp.md), with real time when the blob arrives. Inside a document, order comes from which Change builds on which. But three things read the stated times: which write to a metadata key wins, the order of comments, and [generation](./documents.md) numbers. So a signer with the right to write can give a blob an earlier or a later time. A capability issued after a Ref also makes that Ref valid. If you need a time you can trust, record the CID somewhere outside the protocol that proves time. The protocol itself proves no time. <!-- id:rZDXk-t2 -->

**Nothing checks who may write a Change or a comment.** The daemon stores a Change from any key. The Change becomes part of a document only through an authorized Ref. Any key can attach a public [comment](./comments.md) to any document. Nothing checks it: not the index, and not the API. Moderation is left to clients and sites. <!-- id:TABAN6Hu -->

**A capability never ends and cannot be taken back.** A grant is valid on every node that has it, forever. [Permissions](./permissions.md) says what to do about it: grant narrowly, to keys you control. <!-- id:Ee5-riN- -->

**A peer is not an account.** A peer proves it holds an account only when it wants [private](./privacy.md) data. It signs a short-lived capability that must be less than one minute old. Public data needs no trust in the peer, because anyone can check a public blob by itself. <!-- id:K1wjcasf -->

**Trust in a site is trust in DNS and HTTPS.** The peer that `https://<siteUrl>/hm/api/config` reports receives the space's private blobs, because the [home document](./spaces.md) says that host is the site. Whoever controls the domain and its certificate controls that trust. A space owner who points `siteUrl` at a hostile host gives that host their private content. <!-- id:lZ4F8fRe -->

**The daemon trusts any program that can reach its API.** By default only programs on the same computer can. Such a program can sign with your keys, so keep the API ports private. <!-- id:GCxyZk8- -->

- In default mode, gRPC and HTTP accept only connections from the same computer (loopback).
- HTTP also requires the Host name to be exactly `localhost` or a loopback IP address. It checks the browser's fetch metadata and the exact origin.
- `-api.allowed-origins` adds more trusted origins. It does not widen which connections or Host names the daemon accepts.
- A program the daemon accepts can list keys, sign with stored keys, export keys, store blobs, and create Refs and capabilities.
- A write RPC checks whether the signing key may write. It does not check who the caller is.
- Hosted sites use server mode (`-server-mode`, or `SEED_SERVER_MODE=true`). Server mode trusts the network the server runs in. It hides private content from HTTP requests with no token, and serves it to requests with an authorized bearer token.
- Server mode does not turn writes off. Keep the daemon's API ports private, and proxy only the public `/ipfs/*` routes.

**A bearer token works only on the daemon that made it.** The daemon seals each token with its own random secret. A token lasts thirty days. The only way to cancel it early is to change that secret. The daemon must also still know the token's [principal](../principal.md). A token lets its holder read more on a server-mode node. It never allows a write. [Identity](./identity.md) explains how a token is made. <!-- id:O-MCJker -->

**The same bytes can have two CIDs.** The daemon hashes with BLAKE2b by default, and the [SDK](../build/sdk.md) hashes with SHA-256. Both are valid CIDs of the same content. The daemon treats the two hashes as two blobs. So a Ref that names the SHA-256 head and a Ref that names the BLAKE2b head of the same bytes are two different documents. Always pass the CID yourself for a blob that another blob points at. See [Blobs](./blobs.md). <!-- id:NvliI770 -->

# What to do about the trusted parts <!-- id:we0FdOvO -->

<!-- id:9KFP54wS -->
| Trusted part <!-- col:_8gmy-bk --> | What to do about it <!-- col:o8c578o6 --> <!-- id:C8M3OtL5 --> |
| --- | --- |
| trusted API callers | in default mode, keep API access to the same computer only; on a hosted daemon, keep the API ports private and use `-server-mode`; see [Self-hosting](../operate/self-hosting.md) <!-- id:va4uXiFL --> |
| comments from any key | filter by author or by [contacts](./contacts.md) in the client <!-- id:_dNSAAI5 --> |
| capabilities that never end | grant WRITER on a path to a key you control; give bots and servers their own keys; treat a lost delegate key as lost forever <!-- id:E6SkAwMy --> |
| time stated by the signer | treat `ts` as the author's claim; if the time matters, record the CID somewhere outside the protocol that proves time <!-- id:hMxG5DQa --> |
| site trust | keep control of the domain and certificate; the site's account and signer are visible in `/hm/api/config` <!-- id:1OYen0iH --> |
| two CIDs for the same bytes | always pass a `cid` with every blob you publish that another blob links to <!-- id:I5V7emo6 --> |

# Working with integrity <!-- id:rVRtYCG3 -->

```sh <!-- id:XhZyWaRJ -->
seed-cli blob get <cid>                 # fetch the raw signed blob
seed-cli blob verify <cid>              # check the signature of a stored blob
seed-cli document changes hm://…        # the change DAG with signers and times
seed-cli document cid <cid>             # fetch one raw block by its CID
```

- The CIDs behind a version come from `document changes`. See the [Seed CLI](../build/cli.md). <!-- id:07MEld4- -->
- In the [SDK](../build/sdk.md), `blobs.verify` checks a signature against the signer inside the blob. `signed-blob` does the canonical encoding and the zeroed-signature rule, so your own blob types check the same way. Compute CIDs with `multiformats` and pass them yourself when you publish. <!-- id:5C7ht3P2 -->
- On the [Seed API](../build/web-api.md), `GET /api/GetCID?cid=…` returns a blob as [DAG-JSON](../schema/dag-json.md) so you can inspect it. `GET /api/ListChanges?targetId=…` lists a document's history with signers. `/ipfs/<cid>` on a site serves raw bytes, and you can compute their hash yourself. When you read, you trust the site only to be online. <!-- id:wVT5ffrF -->

# See also <!-- id:4Wlg7DZR -->

- [Blobs](./blobs.md), [Documents](./documents.md), [Identity](./identity.md), [Permissions](./permissions.md), [Privacy](./privacy.md), [Network](./network.md) <!-- id:5FHwtieD -->
- [CID](../cid.md), [Signature](../signature.md), [Timestamp](../timestamp.md) <!-- id:b4zleV6n -->
- [Why signed content](../why/signed-content.md) for a comparison with ActivityPub, and [The end of broken links](../why/broken-links.md) <!-- id:EDttAXTg -->
- [Glossary](../glossary.md) <!-- id:--5qxReP -->
