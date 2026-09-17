---
name: Signature
summary: The 64 raw bytes of an Ed25519 or P-256 signature over a blob's canonical CBOR encoding taken with this very field set to zeros.
---
A **signature** lets anyone verify a blob's author without a server. The private key behind the blob's `signer` produces it, and it covers every other byte of the blob. <!-- id:utoNLsfZ -->

This page defines the **signature** value type, an alias of [bytes](./bytes.md) used for the `sig` field of the [blob](./blob.md) envelope. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:DV0i41WB -->

The signed message is the blob itself with `sig` set to 64 zero bytes, encoded as canonical [DAG-CBOR](./schema/dag-cbor.md). The real signature then replaces the zeros and the blob is encoded again. Verification checks the length first (64 bytes for both Ed25519 and P-256), zeroes the field, re-encodes and verifies. An implementation that signs the blob with the field omitted produces a signature the daemon rejects. Ed25519 signatures are deterministic, which is why the home document's genesis [Change](./change.md) is the same bytes on every device of an account. See [Signed Blobs](./protocol/blobs.md). <!-- id:4yZYrG3F -->

# See also <!-- id:X0yQAGtY -->

- [Signed Blobs](./protocol/blobs.md): the signing rule and encoding. <!-- id:M4eJrZNV -->
- [blob](./blob.md): the envelope that carries `sig`. <!-- id:I_P6RN3i -->
- [principal](./principal.md): the public key that verifies it. <!-- id:TWWpORXq -->
- [Integrity](./protocol/integrity.md): what a signature proves. <!-- id:lqBlZ1Wr -->
