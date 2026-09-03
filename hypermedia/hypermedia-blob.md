---
name: Hypermedia Blob
summary: "The signed base envelope every Hypermedia CBOR blob extends: a `type` tag (the discriminator the network dispatches on), the signer's public key, an Ed25519 sig"
schemaDefinition: ipfs://bafyreigqpwbsy43gcbcbobiokdaucwikmfwbsu2gscepkugejqotv65gye
---
The signed base envelope every Hypermedia CBOR blob extends: a `type` tag (the discriminator the network dispatches on), the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a unix-millisecond timestamp. Change, Ref, Profile, Comment, Capability and Contact all extend it — and so can your own types: extend this schema, pin a `type` tag, and the app signs values with your account. <!-- id:9OHHE4tm -->

This document describes the **hypermedia-blob** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:lToulwCD -->

# Shape <!-- id:QOHOzNqJ -->

A **closed struct** with these fields: <!-- id:bQI8hkFy -->
  - `type` _(required)_ — `string` <!-- id:LQdoRLZZ -->
  - `signer` _(required)_ — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:CtQVur6r -->
  - `sig` _(required)_ — [hypermedia-signature](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-signature) <!-- id:enu99wz8 -->
  - `ts` _(required)_ — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:kWIJ7his -->

# Depends on <!-- id:jpOci9E7 -->

- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:y9c8QnRC -->
- [hypermedia-signature](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-signature) <!-- id:dsCKf5iI -->
- [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp) <!-- id:OFc0RrUw -->
