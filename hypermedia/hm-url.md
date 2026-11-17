---
name: Hypermedia URL
summary: A reference to a Hypermedia document held as an `hm://` URL string, which editors render as a searchable pill showing the target’s title.
---
An **hm-url** is a reference to a Hypermedia [document](./protocol/documents.md), held as an [`hm://` URL](./protocol/urls.md) string. `format: hm-url` tells an editor to render it as a searchable reference that shows the target's title as a pill, instead of the raw URL. A `target` on the field names the schema the referenced document should be typed by: the search then offers documents whose effective attributes schema is that type or any [extension](./schema/extension.md) of it, and a reference outside that set gets a warning, never a block. <!-- id:9OE_xwGa -->

Schemas use the same URLs to point at each other: a `type` such as `hm://hyper.media/string` is a name reference. A name does not depend on content, so names can form cycles, which a [CID](./cid.md) cannot. [References and naming](./schema/references.md) explains this, and what resolves the library's `hm://hyper.media` name. <!-- id:yKu5YAX1 -->

This page describes the **hm-url** type, a value type of [Hypermedia Schemas](./schema.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:G6hl5zLM -->

# See also <!-- id:A4DWj6VN -->

- [URLs](./protocol/urls.md): the full `hm://` syntax. <!-- id:RQHvZ7kw -->
- [References and naming](./schema/references.md): how schemas refer to each other. <!-- id:Mor6vN9_ -->
- [url](./url.md) and [ipfs-url](./ipfs-url.md): the other URL types. <!-- id:LqSgxDJN -->
- [metadata](./metadata.md): `attributesSchema` and `childAttributesSchema` hold this type. <!-- id:XA5FqCzv -->
- [Catalogue of types](./schema/types.md): every type in the library.
