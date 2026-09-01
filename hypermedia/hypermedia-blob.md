---
name: "Signed blob"
summary: "The signed base envelope every Hypermedia CBOR blob extends: a `type` tag (the discriminator the network dispatches on), the signer's public key, an Ed25519 sig"
---

# Signed blob

The signed base envelope every Hypermedia CBOR blob extends: a `type` tag (the discriminator the network dispatches on), the signer's public key, an Ed25519 signature over the canonical CBOR with the signature zeroed, and a unix-millisecond timestamp. Change, Ref, Profile, Comment, Capability and Contact all extend it — and so can your own types: extend this schema, pin a `type` tag, and the app signs values with your account.


This document describes the **hypermedia-blob** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string`
- `signer` *(required)* — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal)
- `sig` *(required)* — [hypermedia-signature](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-signature)
- `ts` *(required)* — [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp)

## Depends on

- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal)
- [hypermedia-signature](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-signature)
- [hypermedia-timestamp](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-timestamp)
