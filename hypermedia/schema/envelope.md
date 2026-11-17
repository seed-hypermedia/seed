---
name: Envelope
summary: The dag-json envelope, which is the reserved `/` key JSON spelling of a link or bytes, and not the signed blob envelope.
---
**Envelope**, on this page, is the dag-json envelope: the JSON spelling of a [link](../link.md) or [bytes](../bytes.md) in [dag-json](./dag-json.md), using the reserved `/` key. A link is `{"/": "bafy…"}` and bytes are `{"/": {"bytes": "…"}}`. It spells a distinct [kind](./kind.md) and is **not** a real map. [Encoding](./encoding.md) has the rules. <!-- id:nVeRWJJj -->

The word also names a different thing. The **signed blob envelope** is the four fields `type`, `signer`, `sig` and `ts` that every signed blob carries. [Blob](../blob.md) defines it, and [Blobs](../protocol/blobs.md) explains it.

# See also <!-- id:NsASq1El -->

- [dag-json](./dag-json.md): the form that uses envelopes. <!-- id:ViOqwJ4J -->
- [Encoding](./encoding.md): reserved keys and the canonical form. <!-- id:IJbmBNLF -->
- [Kind](./kind.md): `link` and `bytes` are kinds of their own. <!-- id:I_H96JwO -->
- [Blobs](../protocol/blobs.md): the signed blob envelope, the other meaning of the word.
