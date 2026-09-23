---
name: Blob
summary: The signed envelope every Hypermedia blob extends, with a type tag, the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a millisecond timestamp.
---
A **blob** envelope is the signed base every Hypermedia CBOR [blob](./protocol/blobs.md) extends. It has four fields: a `type` tag that the network dispatches on, the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a Unix-millisecond timestamp. [Change](./change.md), [Ref](./ref.md), [Profile](./profile.md), [Comment](./comment.md), [Capability](./capability.md) and [Contact](./contact.md) all extend it. Your own types can extend it too: extend this schema, pin a `type` tag, and the app signs values with your account. <!-- id:9OHHE4tm -->

This page defines the **blob** envelope. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and sign values of types that extend it. <!-- id:lToulwCD -->

These four fields are all the network needs to trust a piece of data. `type` says which decoder and which rules apply. The daemon finds it by scanning the raw bytes for the text `"type"` followed by a known name, so pick a distinct tag for your own types. `signer` is the [principal](./principal.md) of the key that produced the blob, as bytes. `sig` is the [signature](./signature.md). `ts` is the [timestamp](./timestamp.md) the signer gives the blob. Nothing checks `ts` against a clock on arrival, so it is a claim, ordered only relative to the blobs it depends on. <!-- id:N0z8DTUN -->

Third-party implementations most often get the signing rule wrong, so here it is exactly. Fill `sig` with 64 zero bytes, encode the whole map as canonical [DAG-CBOR](./schema/dag-cbor.md), sign those bytes, put the signature in `sig`, and encode again. The final bytes are the blob, and their hash is its [CID](./cid.md). Verification zeroes the field again and checks the signature over the re-encoded bytes. Omitting the field instead of zeroing it gives a different message and an invalid signature. <!-- id:R9US3xC6 -->

The [daemon](./apps/daemon.md) computes CIDs with BLAKE2b-256, and the [SDK](./build/sdk.md) and the apps use SHA-256. Both are accepted. A blob that another blob references by CID must be published under the CID the referrer used. [Signed Blobs](./protocol/blobs.md) explains the rule and its consequences. <!-- id:nGAH7ftn -->

# See also <!-- id:M8oK5GWj -->

- [Signed Blobs](./protocol/blobs.md): encoding, CIDs, the six types, what the daemon accepts, stashes and rejects. <!-- id:0IYlzuuU -->
- [Identity](./protocol/identity.md): how a key becomes a principal. <!-- id:kuxGUzYU -->
- [Network blobs](./schema/blobs.md): how the envelope is expressed as a schema extension. <!-- id:SMx3d91O -->
- The types that extend it: [change](./change.md), [ref](./ref.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md). <!-- id:rpxouCRj -->
- [blob/any](./blob/any.md): the union of all six types. <!-- id:Fm0x_ZKU -->
