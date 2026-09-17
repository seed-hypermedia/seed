---
name: Signed Blobs
summary: Every piece of Hypermedia data is an immutable, content-addressed DAG-CBOR blob signed by the key that wrote it, and this page explains the envelope, the signing rule, the CIDs, and the six blob types.
---
Everything in Hypermedia is made of small immutable pieces of data called blobs. A blob is named by the hash of its own bytes, so it can never be altered without changing its name, and it carries the signature of the account that wrote it, so anyone holding the bytes can check who made them without asking a server. Documents, comments, permissions and profiles are all built by combining blobs.

This page describes the blob layer itself. [Documents](./documents.md) explains how Change and Ref blobs combine into a mutable document, and [Integrity](./integrity.md) explains what the signatures do and do not prove.

# Encoding and naming

A blob is a [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) value: a map with text keys, encoded in the [canonical form](../schema/canonical-encoding.md) (sorted keys, shortest integers, no duplicates), where links to other blobs are native [CID](../cid.md) values (CBOR tag 42). Optional fields that are unset are omitted, never written as null. Because the encoding is canonical, the same logical value always yields the same bytes, and the same bytes always yield the same name.

The name of a blob is its [CID](https://docs.ipfs.tech/concepts/content-addressing/), a self-describing hash. Hypermedia uses CIDv1 with the `dag-cbor` codec (0x71) for structured blobs. Files and images are stored as ordinary IPFS [UnixFS](https://docs.ipfs.tech/concepts/file-systems/) data: `dag-pb` (0x70) nodes with `raw` (0x55) leaves. Those are not signed and are covered in [Files](./files.md).

## Two hash functions, one rule

The Seed daemon hashes the blobs it creates with **BLAKE2b-256**. The SDK, the CLI and the Seed web and desktop apps hash the same bytes with **SHA-256**. Both are valid CIDs for the same bytes, and the daemon accepts either on ingest: when you upload a blob with an explicit CID, it verifies the bytes against whatever hash function that CID names. When you upload a blob **without** a CID, the daemon assumes DAG-CBOR and computes a BLAKE2b CID.

That leads to the one rule every publisher must follow: **a blob that another blob references by CID must be uploaded with the exact CID the referrer used.** If a Ref names a Change by its SHA-256 CID and you let the daemon compute a BLAKE2b CID for that Change, the Ref points at a name nobody stored. The daemon stores blocks by multihash, so the two names never collide in storage, but they are two different identities as far as links are concerned: a version made of the SHA-256 heads and a version made of the BLAKE2b heads of the same bytes are different versions. The home-document genesis (see [Documents](./documents.md)) is pinned under both CIDs by tests in the daemon and the SDK for exactly this reason.

# The signed envelope

Every structured blob embeds the same four fields, defined by the [blob](../blob.md) schema:

| key | CBOR type | meaning |
| --- | --- | --- |
| `type` | text | `"Change"`, `"Ref"`, `"Comment"`, `"Capability"`, `"Contact"` or `"Profile"` |
| `signer` | bytes | the [principal](../principal.md) of the signing key: a multicodec prefix plus the raw public key |
| `sig` | bytes | the [signature](../signature.md), 64 bytes for Ed25519 and for P-256 |
| `ts` | integer | the [timestamp](../timestamp.md) in Unix milliseconds |

The `signer` is bytes, not a string. Its string form (multibase base58btc, so it starts with `z6Mk…` for Ed25519) is what you see in URLs and in the apps; see [Identity](./identity.md) for how keys become principals.

## The signing rule

Signing does not omit the signature field; it fills it with zeros:

1. Set `sig` to 64 zero bytes.
2. Encode the whole map as canonical DAG-CBOR.
3. Sign those bytes with the signer's private key.
4. Put the real signature into `sig` and encode again. Those final bytes are the blob, and their hash is its CID.

Verification runs the same steps backwards: check the signature length, copy the signature out, zero the field in place, re-encode, verify against the re-encoded bytes. The message that is signed is therefore "the blob with a zeroed signature", never "the blob without a signature". A third-party implementation that drops the field instead of zeroing it produces signatures the daemon rejects. The SDK and the daemon agree on this rule, and the daemon's `PrepareDocumentChange` API returns an unsigned Change with null `signer` and `sig` that a client completes with the same steps.

One legacy wrinkle: the daemon verifies Comment signatures over the blob decoded as an opaque map rather than as the typed struct, because early comments were encoded slightly differently. Every other type is verified after a strict typed decode.

## Timestamps

`ts` is an integer of Unix milliseconds, and the daemon refuses to encode or decode a timestamp that is not rounded to a millisecond. Producers use a causal clock: each new timestamp is strictly greater than any timestamp the node has seen, and a node whose wall clock is more than 40 seconds behind the newest timestamp it has tracked refuses to issue one at all. Nothing checks `ts` against real time when a blob arrives; the constraints on it are relative ordering inside a document's history, described in [Documents](./documents.md), and that is a deliberate limit noted in [Integrity](./integrity.md). A timestamp of exactly zero is a sentinel used by the deterministic home-document genesis.

# The blob types

| `type` | what it is | resource it builds | detail |
| --- | --- | --- | --- |
| `Change` | a signed delta on a document: operations plus links to the changes it depends on | a document, together with Refs | [Change](../change.md) |
| `Ref` | a signed claim that a path in a space points at a set of head Changes, or is deleted, or redirects | the address of a document | [Ref](../ref.md) |
| `Comment` | a whole comment on a document, replaced entirely when edited | a comment thread | [Comment](../comment.md), [Comments](./comments.md) |
| `Capability` | a grant from a space owner to another key, with a role and a path scope | permissions | [Capability](../capability.md), [Permissions](./permissions.md) |
| `Contact` | one account's public note about another, replaced entirely when edited | contacts and following | [Contact](../contact.md) |
| `Profile` | an account's name, avatar and description, or an alias to another account | the profile | [Profile](../profile.md), [Identity](./identity.md) |
| `dag-pb` and `raw` | UnixFS file nodes and chunks; not signed | files and images | [Files](./files.md) |

Change is the only delta type. The other four signed types are **snapshot blobs**: an edit publishes a new blob carrying the full value, and the newest one wins. Snapshot blobs are addressed by a **TSID** (timestamped id), described below, rather than by a path.

The proto schema for every blob type is in this library: the root pages [blob](../blob.md), [change](../change.md), [ref](../ref.md), [comment](../comment.md), [capability](../capability.md), [contact](../contact.md) and [profile](../profile.md) each carry their formal schema, and [Network blobs](../schema/blobs.md) explains how they were schematised.

# What the daemon does with a blob

The daemon indexes only `dag-cbor` and `dag-pb` blocks. It recognises a structured blob by scanning the raw bytes for the CBOR text `"type"` immediately followed by one of the six type names. That is a byte match, not a parse: any DAG-CBOR blob containing `"type":"Ref"` at any depth is treated as a Ref. Keep that in mind when designing your own blob types; give them a distinct `type` tag, as the [Hypermedia Schemas](../schema.md) tooling does.

| outcome | when |
| --- | --- |
| stored, not indexed | codec is neither dag-cbor nor dag-pb, or the bytes contain no known `type` marker |
| **rejected**, and the whole upload batch fails | the marker matches but the typed decode fails, the signature fails, an operation contains an unknown field, the Change or Ref invariants are violated, an AGENT capability carries a path, a label is too long, a profile breaks its rules, or a comment reply has no thread root |
| **stashed**: bytes kept, meaning withheld, retried later | a dependency, head, thread root or target has not arrived yet; or the Ref's signer is not an authorised writer of the path; or a profile alias is not yet backed by a capability |
| indexed | everything else |

Stashing is what makes arrival order irrelevant: blobs can reach a node in any order over the network, and each one is interpreted as soon as everything it points at is present and its signer is allowed to say what it says. The authorisation part of that rule is in [Permissions](./permissions.md).

Two limits: a single blob may be at most 2 MiB, the Bitswap block-size limit, and each upload batch is atomic.

# TSIDs

Snapshot blobs need a stable identity that survives edits. A TSID is 10 bytes: a 48-bit big-endian Unix-millisecond timestamp followed by the first 4 bytes of the SHA-256 of the blob's bytes, written as base58btc multibase, which comes out at 14 or 15 characters. The first version of a comment, contact or profile derives its TSID from its own bytes; an edit or a tombstone carries the original TSID in its `id` field so the daemon knows which record it replaces. The full identity of such a record is `<signer principal>/<tsid>`, which is also what appears in URLs; see [URLs](./urls.md).

# A worked example

This is a Version Ref as the CLI prints it with `seed-cli blob get`, in [DAG-JSON](https://ipld.io/specs/codecs/dag-json/spec/), where a CID is spelled `{"/": "…"}` and bytes are spelled `{"/": {"bytes": "…"}}`:

```json
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

There is no `space` field because the signer is the space; the daemon omits it when they are equal. There is no `visibility` because the empty value means public. The blob says: "the key `signer` claims that, as of `ts`, the path `/notes/sushi` in its own space points at the document whose first change is `genesisBlob` and whose current state is the single head in `heads`."

# Working with blobs

## In the Seed app

You rarely see a blob. With the Developer Tools experiment enabled, a document's options menu gains "Inspect Document", which opens the inspector (an `hm://inspect/…` address): the Refs and Changes behind the document, each openable by CID.

## CLI

```sh
seed-cli blob get <cid>                     # print any blob as DAG-JSON
seed-cli blob verify <cid>                  # check the signature (and a schema, with -s)
seed-cli blob sign -f value.json -t MyType  # add signer/ts/sig to a value and publish it
seed-cli blob create -f value.json          # publish an unsigned DAG-CBOR value
seed-cli document changes <hm-url>          # the Change blobs behind a document
```

`blob sign` is how you publish your own blob types with the same envelope; pair it with a schema as described in [Hypermedia Schemas](../schema.md). The full command list is in [the CLI reference](../build/cli.md).

## SDK

`@seed-hypermedia/client` implements the envelope once and every higher-level builder uses it: `sign(signer, blob)` zeroes and signs, `encode(blob)` produces the DAG-CBOR bytes and the SHA-256 CID, `decodeBlob(bytes, cid)` checks the bytes against the CID, and `verify(blob)` checks a signature. For arbitrary values there is `signBlob`, `verifySignedBlob` and `encodeDagCbor`. Publishing is `client.publish({blobs: [{cid, data}]})`, which is the `PublishBlobs` request below. See [the SDK guide](../build/sdk.md) for the builders (`createChange`, `createVersionRef`, `createComment`, `createCapability`, …).

## Web API

- `POST /api/PublishBlobs` with `{blobs: [{cid?, data}]}` stores a batch atomically and returns the CIDs in order. Supply `cid` for every blob another blob references.
- `GET /api/GetCID?cid=<cid>` returns the decoded value of any stored blob as JSON.
- On the daemon's own HTTP port, `GET /ipfs/<cid>` serves the raw block and `GET /ipfs/<cid>.dagjson` the decoded form.

The request catalogue is in [the Seed API guide](../build/web-api.md).

## Agents

Seed Agents read and write blobs through their two address verbs. `read ipfs://<cid>` returns a file, or for a DAG-CBOR blob the decoded object together with a signature check and, when the blob names a schema, a validation result. `write ipfs://<cid>` publishes a memory file, an attachment or a JSON object as blobs. Writes to `hm://` addresses sign Change, Ref, Comment, Capability, Contact and Profile blobs on the agent's behalf with the key its grant allows. An external agent such as Claude Code with the seed-cli skill uses the CLI commands above; see [Agents](../build/agents.md).

# See also

- [Documents](./documents.md): how Changes and Refs become a document.
- [Identity](./identity.md): keys, principals and who may sign.
- [Integrity](./integrity.md): what a signature proves, and what it does not.
- [Files](./files.md): the unsigned UnixFS side.
- Schema pages: [blob](../blob.md), [cid](../cid.md), [principal](../principal.md), [signature](../signature.md), [timestamp](../timestamp.md), [DAG-CBOR](../schema/dag-cbor.md), [canonical encoding](../schema/canonical-encoding.md), [Network blobs](../schema/blobs.md).
