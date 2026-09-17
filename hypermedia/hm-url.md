---
name: Resource URL
summary: A reference to a Hypermedia document held as an `hm://` URL string, which editors render as a searchable pill showing the target’s title.
schemaDefinition: ipfs://bafyreiafkupvge7zvxw7tb5cchncqflp33qwsaib5qi3mxl3knerkwzowq
---
An **`hm://` URL** is a [name reference](./schema/references.md): how one schema points at another (`hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string`). A name does not depend on content, so names can form cycles, which a [CID](./cid.md) cannot. That is what makes recursion expressible. Local filenames are the dev alias (`string` ⇄ `hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string`). <!-- id:yKu5YAX1 -->

As a value type it is a reference to a Hypermedia [document](./protocol/documents.md), held as an `hm://` URL string. `format: hm-url` tells an editor to render it as a searchable reference that shows the target's title as a pill, instead of the raw URL. <!-- id:9OE_xwGa -->

This page describes the **hm-url** type, a value type of [Hypermedia Schemas](./schema.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:G6hl5zLM -->

# Shape <!-- id:H_xRODWw -->

Kind: `string`. <!-- id:jtyGQxC6 -->

# See also <!-- id:A4DWj6VN -->

- [URLs](./protocol/urls.md): the full `hm://` syntax. <!-- id:RQHvZ7kw -->
- [References and naming](./schema/references.md): how schemas refer to each other. <!-- id:Mor6vN9_ -->
- [url](./url.md) and [ipfs-url](./ipfs-url.md): the other URL types. <!-- id:LqSgxDJN -->
- [metadata](./metadata.md): `attributesSchema` and `childAttributesSchema` hold this type. <!-- id:XA5FqCzv -->
