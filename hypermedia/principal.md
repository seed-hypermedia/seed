---
name: Principal
summary: A public key that identifies an account or space, stored in blobs as the raw bytes of a multicodec prefix plus the key and shown to people as a base58 string starting with z6Mk.
---
A **principal** is a public key used as a name. Hypermedia names a person, an organisation or a device by its public key, with no registry in between. The same key is the [account](./protocol/identity.md), the identity that signs, and the [space](./protocol/spaces.md), the namespace `hm://<principal>/…` that it owns. <!-- id:2V_agoTg -->

This page defines the **principal** value type. It is an alias of [bytes](./bytes.md). Every [blob](./blob.md) uses it for its `signer`, and for the `space`, `delegate`, `subject`, `account` and `alias` fields. Its formal schema is attached to this [document](./protocol/documents.md) as the `schemaDefinition` key of its metadata, so the app can show it. <!-- id:nSTESG7U -->

The bytes are a [multicodec](https://github.com/multiformats/multicodec) code, written as an unsigned varint, followed by the raw public key. For Ed25519 the code is 0xed, so a principal is 34 bytes: `ed 01` plus the 32-byte key. The string form is those bytes in multibase base58btc. That is why every account you see starts with `z6Mk`. It is exactly the `did:key` encoding of an Ed25519 key. The [daemon](./software/daemon.md) also accepts ECDSA P-256 keys (a compressed 33-byte key), whose string form starts with `zDn`. This lets a browser [session key](./build/sign-in.md) made with WebCrypto sign. Every key the daemon itself creates is Ed25519. In CBOR a principal is a byte string, never text. Anything that takes a principal takes the text form or the raw bytes, and rejects a key of the wrong length. <!-- id:WVskuNtB -->

A principal also has a short form: the first 7 bytes of its SHA-256, read as a little-endian 56-bit number. It is the `actor` part of every [op id](./change/op.md) inside a document. [Identity](./protocol/identity.md) covers how keys are derived from a mnemonic, stored, and delegated to other keys. <!-- id:cL_K5O_W -->

# See also <!-- id:AuwvOpwm -->

- [Identity](./protocol/identity.md): accounts, keys and delegation. <!-- id:0BkCHLry -->
- [signature](./signature.md): what a principal's key produces. <!-- id:TnZEaNt1 -->
- [blob](./blob.md): the `signer` field. <!-- id:k7GSK4m2 -->
- [Keys](./build/keys.md): key files and the keyring. <!-- id:0XfN_SDP -->
- [authority](./authority.md): a key that owns a namespace. <!-- id:2U8H8yqz -->
