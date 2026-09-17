---
name: Blob
summary: The signed envelope every Hypermedia blob extends, with a type tag, the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a millisecond timestamp.
schemaDefinition: ipfs://bafyreihyn2t2ohxof224okmb4ditzzigvbhajqfylhj4fe77uggczihdlm
---
The signed base envelope every Hypermedia CBOR blob extends: a `type` tag (the discriminator the network dispatches on), the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a unix-millisecond timestamp. Change, Ref, Profile, Comment, Capability and Contact all extend it — and so can your own types: extend this schema, pin a `type` tag, and the app signs values with your account. <!-- id:9OHHE4tm -->

This page defines the **blob** envelope, the base every signed Hypermedia network blob extends. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and sign values of types that extend it. <!-- id:lToulwCD -->

The four fields are the whole of what the network needs to trust a piece of data. `type` says which decoder and which rules apply; the daemon recognises it by scanning the raw bytes for the text `"type"` followed by a known name, so choose a distinct tag for your own types. `signer` is the [principal](./principal.md) of the key that produced the blob, as bytes. `sig` is the signature, and `ts` is when the signer says the blob was made. Nothing checks `ts` against a clock on arrival, so it is a claim, ordered only relative to the blobs it depends on. <!-- id:N0z8DTUN -->

The signing rule is precise and worth restating because it is the one thing third-party implementations get wrong: fill `sig` with 64 zero bytes, encode the whole map as canonical DAG-CBOR, sign those bytes, place the signature in `sig`, encode again. The final bytes are the blob and their hash is its CID. Verification zeroes the field again and checks the signature over the re-encoded bytes. Omitting the field instead of zeroing it yields a different message and an invalid signature. <!-- id:R9US3xC6 -->

The daemon computes CIDs with BLAKE2b-256, the SDK and the apps with SHA-256, and both are accepted; a blob that another blob references by CID must be published under the CID the referrer used. [Signed Blobs](./protocol/blobs.md) explains the rule and the consequences. <!-- id:nGAH7ftn -->

# Shape <!-- id:QOHOzNqJ -->

A **closed struct** with these fields: <!-- id:bQI8hkFy -->
  - `type` _(required)_ — `string` <!-- id:LQdoRLZZ -->
  - `signer` _(required)_ — [principal](./principal.md) <!-- id:CtQVur6r -->
  - `sig` _(required)_ — [signature](./signature.md) <!-- id:enu99wz8 -->
  - `ts` _(required)_ — [timestamp](./timestamp.md) <!-- id:kWIJ7his -->

# Depends on <!-- id:jpOci9E7 -->

- [principal](./principal.md) <!-- id:y9c8QnRC -->
- [signature](./signature.md) <!-- id:dsCKf5iI -->
- [timestamp](./timestamp.md) <!-- id:OFc0RrUw -->

# See also <!-- id:M8oK5GWj -->

- [Signed Blobs](./protocol/blobs.md): encoding, CIDs, the six types, what the daemon accepts, stashes and rejects. <!-- id:0IYlzuuU -->
- [Identity](./protocol/identity.md): how a key becomes a principal. <!-- id:kuxGUzYU -->
- [Network blobs](./schema/blobs.md): how the envelope is expressed as a schema extension. <!-- id:SMx3d91O -->
- The types that extend it: [change](./change.md), [ref](./ref.md), [comment](./comment.md), [capability](./capability.md), [contact](./contact.md), [profile](./profile.md). <!-- id:rpxouCRj -->
