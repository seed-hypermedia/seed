---
name: Blob
summary: The signed envelope every Hypermedia blob extends, with a type tag, the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a millisecond timestamp.
---
A **blob** envelope is the signed base every Hypermedia CBOR [blob](./protocol/blobs.md) extends. It has four fields: a `type` tag that the network dispatches on, the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a Unix-millisecond timestamp. [Change](./change.md), [Ref](./ref.md), [Profile](./profile.md), [Comment](./comment.md), [Capability](./capability.md) and [Contact](./contact.md) all extend it. Your own types can extend it too: extend this schema, pin a `type` tag, and the app signs values with your account. <!-- id:9OHHE4tm -->

This page defines the **blob** envelope. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and sign values of types that extend it. <!-- id:lToulwCD -->

These four fields are all the network needs to trust a piece of data. `type` says which decoder and which rules apply. The daemon finds it by scanning the raw bytes for the text `"type"` followed by a known name, so pick a distinct tag for your own types. `signer` is the [principal](./principal.md) of the key that produced the blob, as bytes. `sig` is the [signature](./signature.md). `ts` is the [timestamp](./timestamp.md) the signer gives the blob. Nothing checks `ts` against a clock on arrival, so it is a claim, ordered only relative to the blobs it depends on. <!-- id:N0z8DTUN -->

# Fields

<!-- id:pswiXeCA -->
| key <!-- col:t3qWvl2d --> | CBOR type <!-- col:4-f3FKCa --> | meaning <!-- col:8b49Zwu7 --> <!-- id:75JN_Jwz --> |
| --- | --- | --- |
| `type` | text | `"Change"`, `"Ref"`, `"Comment"`, `"Capability"`, `"Contact"` or `"Profile"` <!-- id:movgKdIU --> |
| `signer` | bytes | the [principal](./principal.md) of the signing key: a multicodec prefix plus the raw public key <!-- id:-Jvjg17G --> |
| `sig` | bytes | the [signature](./signature.md), 64 bytes for Ed25519 and for P-256 <!-- id:rsnPhmwR --> |
| `ts` | integer | the [timestamp](./timestamp.md) in Unix milliseconds <!-- id:5sAxNStB --> |

# The signing rule <!-- id:CGFv9qfW -->

Third-party implementations most often get the signing rule wrong, so here it is exactly. <!-- id:R9US3xC6 -->

Signing fills the signature field with zeros first: <!-- id:VNf8aZMm -->
  1. Set `sig` to 64 zero bytes. <!-- id:bv5lyS55 -->
  2. Encode the whole map as canonical DAG-CBOR. <!-- id:Zy3nuSXx -->
  3. Sign those bytes with the signer's private key. <!-- id:zFYPhpBc -->
  4. Put the real signature into `sig` and encode again. Those final bytes are the blob, and their hash is its CID. <!-- id:zBbbQ23Z -->

Verification runs the same steps backwards: check the signature length, copy the signature out, zero the field in place, re-encode, verify against the re-encoded bytes. The signed message is the blob with a zeroed signature. A third-party implementation that drops the field instead of zeroing it produces signatures the daemon rejects. The [SDK](./build/sdk.md) and the daemon agree on this rule. The `PrepareDocumentChange` API (the daemon's `PrepareChange`) returns an unsigned Change with null `signer` and `sig` that a client completes with the same steps. <!-- id:ziJbERbT -->

One legacy case: the daemon verifies Comment signatures over the blob decoded as an opaque map instead of the typed struct, because early comments were encoded slightly differently. Every other type is verified after a strict typed decode. <!-- id:3-pNNr1- -->

The [daemon](./software/daemon.md) computes CIDs with BLAKE2b-256, and the [SDK](./build/sdk.md) and the apps use SHA-256. Both are accepted. A blob that another blob references by CID must be published under the CID the referrer used. [Signed Blobs](./protocol/blobs.md) explains the rule and its consequences. <!-- id:nGAH7ftn -->

# See also <!-- id:M8oK5GWj -->

- [Signed Blobs](./protocol/blobs.md): encoding, CIDs, the six types, what the daemon accepts, stashes and rejects. <!-- id:0IYlzuuU -->
- [Identity](./protocol/identity.md): how a key becomes a principal. <!-- id:kuxGUzYU -->
- [Network blobs](./schema/blobs.md): how the envelope is expressed as a schema extension. <!-- id:SMx3d91O -->
- The types that extend it: [change](./change.md), [ref](./ref.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md). <!-- id:rpxouCRj -->
- [blob/any](./blob/any.md): the union of all six types. <!-- id:Fm0x_ZKU -->

# Pages in this section <!-- id:JqQS5rdh attrs:{"childrenType":"Grid","columnCount":3} -->

<./blob/any.md> <!-- id:qyiJNOWh type:Embed attrs:{"view":"Card"} -->
