---
name: Signature
summary: The 64 raw bytes of an Ed25519 or P-256 signature over a blob's canonical CBOR encoding taken with this very field set to zeros.
---
A **signature** lets anyone check who wrote a blob, without asking a server. The private key behind the blob's `signer` makes it. It covers every other byte of the blob. <!-- id:utoNLsfZ -->

This page defines the **signature** value type. It is an alias of [bytes](./bytes.md), used for the `sig` field of the [blob](./blob.md) envelope. Its formal schema is attached to this [document](./protocol/documents.md) as the `schemaDefinition` key of its metadata, so the app can show it. <!-- id:DV0i41WB -->

The signed message is the blob itself with `sig` set to 64 zero bytes, encoded as canonical [DAG-CBOR](./schema/dag-cbor.md). The real signature then replaces the zeros, and the blob is encoded again. To verify, a program checks the length first (64 bytes for both Ed25519 and P-256), sets the field to zeros, encodes again and verifies. A program that signs the blob with the field left out makes a signature the [daemon](./software/daemon.md) rejects. The same Ed25519 key always gives the same signature for the same bytes. That is why the [genesis](./protocol/documents.md) [Change](./change.md) of a [home document](./protocol/spaces.md) is the same bytes on every device of an [account](./protocol/identity.md). See [Signed Blobs](./protocol/blobs.md). <!-- id:4yZYrG3F -->

# See also <!-- id:X0yQAGtY -->

- [Signed Blobs](./protocol/blobs.md): the signing rule and encoding. <!-- id:M4eJrZNV -->
- [blob](./blob.md): the envelope that carries `sig`. <!-- id:I_P6RN3i -->
- [principal](./principal.md): the public key that verifies it. <!-- id:TWWpORXq -->
- [Integrity](./protocol/integrity.md): what a signature proves. <!-- id:lqBlZ1Wr -->
- [Catalogue of types](./schema/types.md): every type in the library.
