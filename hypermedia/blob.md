---
name: Blob
summary: The signed envelope every Hypermedia blob extends, with a type tag, the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a millisecond timestamp.
---
Every signed piece of Hypermedia data starts with the same four fields. Together they are called the **blob** envelope. They say what kind of data this is (`type`), who signed it (`signer`), the signature (`sig`), and when it was signed (`ts`). The signature covers the whole [blob](./protocol/blobs.md), encoded as canonical CBOR with the signature field set to zeros. [Change](./change.md), [Ref](./ref.md), [Profile](./profile.md), [Comment](./comment.md), [Capability](./capability.md) and [Contact](./contact.md) all start with this envelope. Your own types can too: extend this schema, pick a `type` tag, and the app signs values with your account. <!-- id:9OHHE4tm -->

This page defines the **blob** envelope. Its formal schema is attached to this [document](./protocol/documents.md) as the `schemaDefinition` key of its metadata. So the app can show the schema and sign values of types that extend it. <!-- id:lToulwCD -->

The network needs only these four fields to trust a piece of data. `type` says which decoder and which rules apply. The daemon finds it by scanning the raw bytes for the text `"type"` followed by a known name, so pick a distinct tag for your own types. `signer` is the [principal](./principal.md) of the key that made the blob, as bytes. `sig` is the [signature](./signature.md). `ts` is the [timestamp](./timestamp.md) the signer gives the blob. Nothing compares `ts` with a clock when the blob arrives. So `ts` is a claim. It is ordered only against the blobs this blob depends on. <!-- id:N0z8DTUN -->

# Fields

<!-- id:pswiXeCA -->
| key <!-- col:t3qWvl2d --> | CBOR type <!-- col:4-f3FKCa --> | meaning <!-- col:8b49Zwu7 --> <!-- id:75JN_Jwz --> |
| --- | --- | --- |
| `type` | text | `"Change"`, `"Ref"`, `"Comment"`, `"Capability"`, `"Contact"` or `"Profile"`, or your own tag <!-- id:movgKdIU --> |
| `signer` | bytes | the [principal](./principal.md) of the signing key: a multicodec prefix plus the raw public key <!-- id:-Jvjg17G --> |
| `sig` | bytes | the [signature](./signature.md), 64 bytes for Ed25519 and for P-256 <!-- id:rsnPhmwR --> |
| `ts` | integer | the [timestamp](./timestamp.md) in Unix milliseconds <!-- id:5sAxNStB --> |

# The signing rule <!-- id:CGFv9qfW -->

Programs written outside Seed often get the signing rule wrong, so here it is exactly. <!-- id:R9US3xC6 -->

To sign, fill the signature field with zeros first: <!-- id:VNf8aZMm -->
  1. Set `sig` to 64 zero bytes. <!-- id:bv5lyS55 -->
  2. Encode the whole map as canonical [DAG-CBOR](./schema/dag-cbor.md). <!-- id:Zy3nuSXx -->
  3. Sign those bytes with the signer's private key. <!-- id:zFYPhpBc -->
  4. Put the real signature into `sig` and encode again. Those final bytes are the blob, and their hash is its [CID](./cid.md). <!-- id:zBbbQ23Z -->

To verify, run the same steps backwards. Check the signature length. Copy the signature out. Set the field to zeros in place. Encode again. Verify the signature against those bytes. So the signed message is the blob with a zeroed signature. A program that drops the field, and does not zero it, makes signatures the daemon rejects. The [SDK](./build/sdk.md) and the daemon follow the same rule. The `PrepareDocumentChange` API (the daemon's `PrepareChange`) returns an unsigned Change with null `signer` and `sig`. A client completes it with the same steps. <!-- id:ziJbERbT -->

One special case: the daemon checks the signature of a [comment](./protocol/comments.md) over the blob decoded as a plain map, not as the typed [struct](./struct.md). Some stored comments are encoded slightly differently, and this keeps them valid. The daemon checks every other type after a strict typed decode. <!-- id:3-pNNr1- -->

The [daemon](./software/daemon.md) computes CIDs with BLAKE2b-256. The [SDK](./build/sdk.md) and the apps use SHA-256. Both are accepted. When one blob points at another by CID, publish the second blob under exactly the CID the first one used. [Signed Blobs](./protocol/blobs.md) explains the rule and what follows from it. <!-- id:nGAH7ftn -->

# See also <!-- id:M8oK5GWj -->

- [Signed Blobs](./protocol/blobs.md): encoding, CIDs, the six types, what the daemon accepts, stashes and rejects. <!-- id:0IYlzuuU -->
- [Identity](./protocol/identity.md): how a key becomes a principal. <!-- id:kuxGUzYU -->
- [Network blobs](./schema/blobs.md): how the envelope is expressed as a schema extension. <!-- id:SMx3d91O -->
- The types that extend it: [change](./change.md), [ref](./ref.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md). <!-- id:rpxouCRj -->
- [blob/any](./blob/any.md): the union of all six types. <!-- id:Fm0x_ZKU -->

# Pages in this section <!-- id:JqQS5rdh attrs:{"childrenType":"Grid","columnCount":3} -->

<./blob/any.md> <!-- id:qyiJNOWh type:Embed attrs:{"view":"Card"} -->
