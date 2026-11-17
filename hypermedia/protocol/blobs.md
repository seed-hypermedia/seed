---
name: Signed Blobs
summary: Every piece of Hypermedia data is a small signed blob named by the hash of its own bytes, and this page explains the envelope, the signing rule, the CIDs and the six blob types.
---
Everything in Hypermedia is made of small pieces of data called blobs. A blob never changes. Its name is the hash of its own bytes, so if the bytes change, the name changes too. A blob also carries the signature of the [account](./identity.md) that wrote it. Anyone who holds the bytes can check who made them, without asking a server. <!-- id:pkqbwbMr -->

[Documents](./documents.md), [comments](./comments.md), [permissions](./permissions.md) and [profiles](../profile.md) are all built from blobs. This page describes the blob layer. [Documents](./documents.md) explains how [Change](../change.md) and [Ref](../ref.md) blobs combine into a document that can change. [Integrity](./integrity.md) explains what the signatures prove and what they do not. <!-- id:1hLKRhu1 -->

# Encoding and naming <!-- id:OoVDzbGV -->

A blob is a [DAG-CBOR](../schema/dag-cbor.md) value: a map with text keys, in a compact binary format. The details: <!-- id:f7gN0YAB -->

- The map is written in the [canonical form](../schema/canonical-encoding.md): sorted keys, shortest integers, no duplicates.
- A link to another blob is a native [CID](../cid.md) value (CBOR tag 42).
- An optional field that is not set is left out. It is never written as null.

Because the encoding is canonical, the same value always gives the same bytes, and the same bytes always give the same name.

The name of a blob is its [CID](../cid.md), a hash that also says which hash function and format it uses. Hypermedia uses CIDv1 with the `dag-cbor` codec (0x71) for structured blobs. Files and images are stored as ordinary IPFS [UnixFS](https://docs.ipfs.tech/concepts/file-systems/) data: `dag-pb` (0x70) nodes with `raw` (0x55) leaves. Those are not signed. [Files](./files.md) covers them. <!-- id:u9cwGN-- -->

## Two hash functions, one rule <!-- id:Uk8XyG9U -->

The same bytes can have two names. The [Seed daemon](../software/daemon.md) names the blobs it creates with a **BLAKE2b-256** hash. The SDK, the CLI and the Seed [web app](../software/web.md) and [desktop app](../software/desktop.md) name the same bytes with a **SHA-256** hash. Both names are valid CIDs, and the daemon accepts either one. <!-- id:BT8XYPDB -->

- When you upload a blob with an explicit CID, the daemon checks the bytes against the hash function that CID names.
- When you upload a blob **without** a CID, the daemon assumes DAG-CBOR and computes a BLAKE2b CID.

So every publisher must follow one rule: **when one blob points at another by CID, upload the second blob under exactly the CID the first one used.** Suppose a Ref names a Change by its SHA-256 CID, and you let the daemon compute a BLAKE2b CID for that Change. Then the Ref points at a name nobody stored. <!-- id:vRLWdowl -->

The daemon stores blobs by multihash, so the two names never collide in storage. For links they are two different identities. A [version](./documents.md) made of the SHA-256 heads and a version made of the BLAKE2b heads of the same bytes are different versions. For this reason, tests in the daemon and the SDK pin the first change of the [home document](./spaces.md) under both CIDs (see [Documents](./documents.md)).

# The signed envelope <!-- id:67mrbAkr -->

Every structured blob has the same four fields: `type`, `signer`, `sig` and `ts`. The [blob](../blob.md) type page is the reference for them and for the exact signing rule. <!-- id:_STw4W2v -->

The `signer` field holds bytes. URLs and the apps show its string form: multibase base58btc, which starts with `z6Mk…` for Ed25519. [Identity](./identity.md) explains how keys become principals. <!-- id:T2-8ODlZ -->

Signing sets the signature field to zeros first. The signer sets `sig` to 64 zero bytes, encodes the map, signs those bytes, and puts the signature back. To verify, a reader does the same steps in reverse. If an implementation drops the field instead of filling it with zeros, the daemon rejects its signatures.

## Timestamps <!-- id:gwd46YK9 -->

`ts` is an integer of Unix milliseconds. The daemon refuses to encode or decode a timestamp that is not rounded to a millisecond. <!-- id:jFvoVqI9 -->

- Producers use a causal clock. Each new timestamp is strictly greater than any timestamp the node has seen.
- A node refuses to issue a timestamp when its wall clock is 40 seconds or more behind the newest timestamp it has tracked.
- Nothing checks `ts` against real time when a blob arrives. The only rules are about relative order inside a document's history, described in [Documents](./documents.md). [Integrity](./integrity.md) lists this as a deliberate limit.
- The one clock check happens later. When a node replays a document, a Change stamped 40 seconds or more ahead of that node's clock fails to apply.
- A timestamp of exactly zero is a special value. Only the deterministic first change of a home document uses it.

# The blob types <!-- id:bH9p9ZZJ -->

<!-- id:F8WxPKf8 -->
| `type` <!-- col:GoukDpD3 --> | what it is <!-- col:ahjHpYEN --> | resource it builds <!-- col:-aGcUsIc --> | detail <!-- col:ZiM3-ER_ --> <!-- id:QjYKczm9 --> |
| --- | --- | --- | --- |
| `Change` | a signed delta on a document: operations plus links to the changes it depends on | a document, together with Refs | [Change](../change.md) <!-- id:Ad1__4cJ --> |
| `Ref` | a signed claim that a path in a [space](./spaces.md) points at a set of head Changes, or is deleted, or redirects | the address of a document | [Ref](../ref.md) <!-- id:jfYnLTc2 --> |
| `Comment` | a whole comment on a document, replaced entirely when edited | a comment thread | [Comment](../comment.md), [Comments](./comments.md) <!-- id:2-Mc4axB --> |
| `Capability` | a grant from a space owner to another key, with a role and a path scope | permissions | [Capability](../capability.md), [Permissions](./permissions.md) <!-- id:-OIVWiA2 --> |
| `Contact` | one account's public note about another, replaced entirely when edited | contacts and following | [Contact](../contact.md), [Contacts](./contacts.md) <!-- id:OHLfC6Iz --> |
| `Profile` | an account's name, avatar and description, or an alias to another account | the profile | [Profile](../profile.md), [Identity](./identity.md) <!-- id:8S1qGL4i --> |
| `dag-pb` and `raw` | UnixFS file nodes and chunks; not signed | files and images | [Files](./files.md) <!-- id:LOZvTu_b --> |

How the types differ: <!-- id:PzO9Vrs3 -->

- Change is the only delta type: a blob that records a difference, not a whole value.
- A Ref holds no content of its own. It points an address at Changes.
- Comments, contacts and profiles are **snapshot blobs**. An edit publishes a new blob that carries the full value, and the newest one wins.
- Comments and contacts are addressed by a **TSID** (timestamped id), described below, instead of a path.
- A profile has one current value per account: the newest.
- A capability is a standalone grant. Nobody edits it.

The formal schema of every blob type is on its type page: [blob](../blob.md), [change](../change.md), [ref](../ref.md), [comment](../comment.md), [capability](../capability.md), [contact](../contact.md) and [profile](../profile.md). [Network blobs](../schema/blobs.md) explains how they were written. <!-- id:sTsUdcWS -->

# What the daemon does with a blob <!-- id:cJ8tozIg -->

The daemon indexes only `dag-cbor` and `dag-pb` blobs. It recognises a structured blob by scanning the raw bytes for the CBOR text `"type"` immediately followed by one of the six type names. This is a byte match with no parse. So the daemon treats any DAG-CBOR blob that contains `"type":"Ref"` at any depth as a Ref. Give your own blob types a distinct `type` tag, as the [Hypermedia Schemas](../schema.md) tooling does. <!-- id:1CKXHjC9 -->

<!-- id:KujhcCw6 -->
| outcome <!-- col:uRD8SJFX --> | when <!-- col:yNtsW24H --> <!-- id:6b3fPmrH --> |
| --- | --- |
| stored, not indexed | codec is neither dag-cbor nor dag-pb, or the bytes contain no known `type` marker <!-- id:Ndc56w2O --> |
| **rejected**, and the whole upload batch fails | the marker matches but the typed decode fails, the signature fails, an operation contains an unknown field, the Change or Ref invariants are violated, an AGENT capability carries a path, a label is too long, a profile breaks its rules, or a comment reply has no thread root <!-- id:3aaMkVjO --> |
| **stashed**: bytes kept, meaning withheld, retried later | a dependency, head, thread root or target has not arrived yet; or the Ref's signer is not an authorised writer of the path; or a profile alias is not yet backed by a capability <!-- id:pU8sXK0m --> |
| indexed | everything else <!-- id:4h0XZREn --> |

Because of stashing, the order of arrival does not matter. Blobs can reach a node in any order over the [network](./network.md). The node reads each one as soon as two things are true: everything the blob points at is present, and its signer is allowed to say what it says. The rule for who is allowed is in [Permissions](./permissions.md). <!-- id:3IfBcST- -->

Two limits apply. A single blob may be at most 2 MiB, the Bitswap block-size limit. Each upload batch is atomic: all of it is stored, or none of it. <!-- id:0e6FFX-i -->

# TSIDs <!-- id:uLQVlr7x -->

A snapshot blob needs an identity that stays the same when the record is edited. That identity is a TSID. <!-- id:7JJBWA4h -->

- A TSID is 10 bytes: a 48-bit big-endian Unix-millisecond timestamp, followed by the first 4 bytes of the SHA-256 of the blob's bytes.
- It is written as base58btc multibase, which comes out at 14 or 15 characters.
- The first version of a [comment](./comments.md) or [contact](./contacts.md) derives its TSID from its own bytes.
- An edit or a tombstone (a blob that marks the record as deleted) carries the original TSID in its `id` field. So the daemon knows which record it replaces.

The full identity of such a record is `<signer principal>/<tsid>`. The same form appears in URLs. See [URLs](./urls.md).

# A worked example <!-- id:AQ6nV8i9 -->

This is a Version [Ref](../ref.md) as the [CLI](../build/cli.md) prints it with `seed-cli blob get`. The output is [DAG-JSON](https://ipld.io/specs/codecs/dag-json/spec/), where a CID is spelled `{"/": "…"}` and bytes are spelled `{"/": {"bytes": "…"}}`: <!-- id:yTD4BPnM -->

```json <!-- id:CZbIHaxg -->
{
  "type": "Ref",
  "signer": {"/": {"bytes": "7QGqK1Pk1vXBhgBk6nbpAy3Q7vLg5AfTt0wLc5Bn8tYb1dw"}},
  "sig": {"/": {"bytes": "…64 bytes…"}},
  "ts": 1757980800000,
  "path": "/notes/sushi",
  "genesisBlob": {"/": "bafyreiao4v2f6a7x3xkfdeb3pkvpj7lmwl2vn2zl4awqk3jx5zkd6nwmqa"},
  "heads": [{"/": "bafyreid3q7zgcqhbebutwvpqmlq5ml5bbp5j3g6o3ry7w4m3wyxghrq2we"}],
  "generation": 1757980800000
}
```

There is no `space` field because the signer is the space. The daemon leaves the field out when they are equal. There is no `visibility` because the empty value means public (see [Privacy](./privacy.md)). The blob says: "the key `signer` claims that, as of `ts`, the path `/notes/sushi` in its own space points at the document whose first change is `genesisBlob` and whose current state is the single head in `heads`." <!-- id:ddhH8DsA -->

# Working with blobs <!-- id:iCaKkmHm -->

```sh <!-- id:Tlb8KZRL -->
seed-cli blob get <cid>                     # print any blob as DAG-JSON
seed-cli blob verify <cid>                  # check the signature (and a schema, with -s)
seed-cli blob sign -f value.json -t MyType  # add signer/ts/sig to a value and publish it
seed-cli blob create -f value.json          # publish an unsigned DAG-CBOR value
seed-cli document changes <hm-url>          # the Change blobs behind a document
```

- `blob sign` publishes your own blob types with the same envelope. Pair it with a schema as described in [Hypermedia Schemas](../schema.md). The full command list is in [Seed CLI](../build/cli.md). <!-- id:Yspq5SQM -->
- The [SDK](../build/sdk.md) implements the envelope in `@seed-hypermedia/client/blobs`: `sign`, `encode`, `decodeBlob` and `verify`. `client.publish({blobs: [{cid, data}]})` stores a batch.
- On the [Seed API](../build/web-api.md), `POST /api/PublishBlobs` with `{blobs: [{cid?, data}]}` stores a batch atomically and returns the CIDs in order. Supply `cid` for every blob that another blob points at. <!-- id:SbDrkiM_ -->
- `GET /api/GetCID?cid=<cid>` returns the decoded value of any stored blob as JSON. <!-- id:2R1W6r8k -->
- [Seed Agents](../agent.md) [read](../agent/read.md) and [write](../agent/write.md) `ipfs://<cid>` addresses. See [Using Seed from your own agent](../build/agents.md).

# See also <!-- id:U8_iES-_ -->

- [Documents](./documents.md): how Changes and Refs become a document. <!-- id:X_-gY2Cc -->
- [Identity](./identity.md): keys, principals and who may sign. <!-- id:mR862nTi -->
- [Integrity](./integrity.md): what a signature proves, and what it does not. <!-- id:ttnccOPl -->
- [Files](./files.md): the unsigned UnixFS side. <!-- id:d6TzWVXx -->
- [Network](./network.md): how blobs move between peers. <!-- id:-UyvyR_V -->
- Schema pages: [blob](../blob.md), [cid](../cid.md), [principal](../principal.md), [signature](../signature.md), [timestamp](../timestamp.md), [DAG-CBOR](../schema/dag-cbor.md), [canonical encoding](../schema/canonical-encoding.md), [Network blobs](../schema/blobs.md). <!-- id:A0KydBLn -->
