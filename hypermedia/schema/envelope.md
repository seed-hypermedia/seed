---
name: Envelope
summary: On this page an envelope is the dag-json way to write a link or bytes with the reserved `/` key, and it is not the envelope of a signed blob.
---
An **envelope**, on this page, is the way [dag-json](./dag-json.md) writes a [link](../link.md) or [bytes](../bytes.md). JSON has no form for either, so dag-json uses a small object with the reserved `/` key. A link is `{"/": "bafy…"}`. Bytes are `{"/": {"bytes": "…"}}`. <!-- id:nVeRWJJj -->

An envelope looks like a map, but it is **not** a map. It stands for a value of another [kind](./kind.md): a link or bytes. [Encoding](./encoding.md) has the rules.

The word also names a different thing. The **signed blob envelope** is the four fields `type`, `signer`, `sig` and `ts` that every signed blob carries. [Blob](../blob.md) defines it, and [Blobs](../protocol/blobs.md) explains it.

# See also <!-- id:NsASq1El -->

- [dag-json](./dag-json.md): the form that uses envelopes. <!-- id:ViOqwJ4J -->
- [Encoding](./encoding.md): reserved keys and the canonical form. <!-- id:IJbmBNLF -->
- [Kind](./kind.md): `link` and `bytes` are kinds of their own. <!-- id:I_H96JwO -->
- [Blobs](../protocol/blobs.md): the signed blob envelope, the other meaning of the word.
