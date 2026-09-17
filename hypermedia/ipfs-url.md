---
name: IPFS URL
summary: A reference to a content-addressed object held as an `ipfs://<cid>` string, which editors render as a file pill you can open, upload to, or paste into.
schemaDefinition: ipfs://bafyreial6bhshluybr2gmrxusva4ksfznmwnznqyephhhrjrpuhzjhphoe
---
An **IPFS URL** is a reference to a content-addressed [file](./protocol/files.md) on IPFS, held as an `ipfs://<cid>` string. `format: ipfs-url` tells an editor to render it as a file reference, a pill you can open and set by upload or paste, instead of a plain text box. <!-- id:NOsddoMm -->

This page describes the **ipfs-url** type, a value type of [Hypermedia Schemas](./schema.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:yxkmJOet -->

# Shape <!-- id:QMcftMQC -->

Kind: `string`. <!-- id:qxF_Hzo6 -->

# See also <!-- id:7sagQBpD -->

- [Files](./protocol/files.md): how files are stored and served. <!-- id:dxwdkolh -->
- [cid](./cid.md): the content identifier inside the URL. <!-- id:F5PfmjmF -->
- [url](./url.md) and [hm-url](./hm-url.md): the other URL types. <!-- id:Znu0NQPL -->
- [metadata](./metadata.md): `icon`, `cover` and `schemaDefinition` hold this type. <!-- id:LQusOTJj -->
