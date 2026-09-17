---
name: Principal
summary: A public key that identifies an account or space, stored in blobs as the raw bytes of a multicodec prefix plus the key and shown to people as a base58 string starting with z6Mk.
schemaDefinition: ipfs://bafyreid2nrqul7ebtujda7ofjvkce3wxrcaonjokyy45xekhbb4wv4ttey
---
A **principal** is how Hypermedia names a person, an organisation or a device: by public key, with no registry in between. The same key is the [account](./protocol/identity.md), the identity that signs, and the space, the namespace `hm://<principal>/…` it owns. <!-- id:2V_agoTg -->

This page defines the **principal** value type, an alias of [bytes](./bytes.md) used for the `signer` of every [blob](./blob.md) and for `space`, `delegate`, `subject`, `account` and `alias` fields. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:nSTESG7U -->

The bytes are an unsigned-varint [multicodec](https://github.com/multiformats/multicodec) code followed by the raw public key. For Ed25519 the code is 0xed, so a principal is 34 bytes: `ed 01` plus the 32-byte key. The string form is multibase base58btc of those bytes, which is why every account you see starts with `z6Mk`. It is exactly the `did:key` encoding of an Ed25519 key. The daemon also registers ECDSA P-256 (compressed 33-byte key), whose string form would start with `zDn`, so that browser session keys made with WebCrypto can sign. Every key the daemon itself creates is Ed25519. In CBOR a principal is a byte string, never text. <!-- id:WVskuNtB -->

A short form of the principal, the first 7 bytes of its SHA-256 read as a little-endian 56-bit number, is the `actor` component of every [op id](./change/op.md) inside a document. [Identity](./protocol/identity.md) covers how keys are derived from a mnemonic, stored, and delegated to other keys. <!-- id:cL_K5O_W -->

# Shape <!-- id:sT34p2wb -->

An **alias** of [bytes](./bytes.md). <!-- id:xRB39OHx -->

# Depends on <!-- id:EnW07RcY -->

- [bytes](./bytes.md) <!-- id:uebSMAU- -->

# See also

- [Identity](./protocol/identity.md): accounts, keys and delegation.
- [signature](./signature.md): what a principal's key produces.
- [blob](./blob.md): the `signer` field.
- [Keys](./build/keys.md): key files and the keyring.
- [authority](./authority.md): a key that owns a namespace.
