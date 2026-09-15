---
name: Blob
summary: "The signed base envelope every Hypermedia CBOR blob extends: a `type` tag (the discriminator the network dispatches on), the signer's public key, an Ed25519 sig"
schemaDefinition: ipfs://bafyreicmcbizte6unjajybr6u4nexsemoubuwida55ty5d52xlvdxsbsqu
---
The signed base envelope every Hypermedia CBOR blob extends: a `type` tag (the discriminator the network dispatches on), the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a unix-millisecond timestamp. Change, Ref, Profile, Comment, Capability and Contact all extend it — and so can your own types: extend this schema, pin a `type` tag, and the app signs values with your account. <!-- id:9OHHE4tm -->

This document describes the **blob** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:lToulwCD -->

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
