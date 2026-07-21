---
name: "Hypermedia blob"
summary: "The signed base envelope embedded in every Hypermedia CBOR blob: a type discriminator, the signer's public key, a signature, and a timestamp."
---

# Hypermedia blob

The signed base envelope embedded in every Hypermedia CBOR blob: a type discriminator, the signer's public key, a signature, and a timestamp.


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
