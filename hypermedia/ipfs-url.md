---
name: IPFS URL
summary: A reference to a content-addressed object held as an `ipfs://<cid>` string, which editors render as a file pill you can open, upload to, or paste into.
---
An **IPFS URL** is a reference to something stored by its content hash on IPFS: a [file](./protocol/files.md), or a [DAG-CBOR](./schema/dag-cbor.md) object such as a schema. It is held as an `ipfs://<cid>` string, where `<cid>` is the [CID](./cid.md) of the content. <!-- id:NOsddoMm -->

`format: ipfs-url` tells an editor to show it as a file reference, not a plain text box. The reference is a pill. You can open it, and you can set it by upload or by paste.

This page defines the **ipfs-url** type, a value type of [Hypermedia Schemas](./schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type. <!-- id:yxkmJOet -->

# See also <!-- id:7sagQBpD -->

- [Files](./protocol/files.md): how files are stored and served. <!-- id:dxwdkolh -->
- [cid](./cid.md): the content identifier inside the URL. <!-- id:F5PfmjmF -->
- [url](./url.md) and [hm-url](./hm-url.md): the other URL types. <!-- id:Znu0NQPL -->
- [metadata](./metadata.md): `icon`, `cover` and `schemaDefinition` hold this type. <!-- id:LQusOTJj -->
- [Catalogue of types](./schema/types.md): every type in the library.
