---
name: Hypermedia URL
summary: A reference to a Hypermedia document held as an `hm://` URL string, which editors render as a searchable pill showing the target’s title.
---
An **hm-url** is a reference to a Hypermedia [document](./protocol/documents.md). It is held as a string: an [`hm://` URL](./protocol/urls.md). `format: hm-url` tells an editor to show it as a searchable reference. The editor shows the target's title as a pill, not the raw URL. <!-- id:9OE_xwGa -->

A `target` on the field names the schema that the referenced document should be typed by. The search then lists first the documents whose effective attributes schema is that type or any [extension](./schema/extension.md) of it. You can still pick another document, and it gets a warning. The editor never refuses it. [Typed documents](./schema/typed-documents.md) explains the effective attributes schema.

Schemas use the same URLs to point at each other. A `type` such as `hm://hyper.media/string` refers to a schema by name. A name does not depend on content, so names can form a loop, and a [CID](./cid.md) cannot. [References and naming](./schema/references.md) explains this, and what resolves the library's `hm://hyper.media` name. <!-- id:yKu5YAX1 -->

This page defines the **hm-url** type, a value type of [Hypermedia Schemas](./schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type. <!-- id:G6hl5zLM -->

# See also <!-- id:A4DWj6VN -->

- [URLs](./protocol/urls.md): the full `hm://` syntax. <!-- id:RQHvZ7kw -->
- [References and naming](./schema/references.md): how schemas refer to each other. <!-- id:Mor6vN9_ -->
- [url](./url.md) and [ipfs-url](./ipfs-url.md): the other URL types. <!-- id:LqSgxDJN -->
- [metadata](./metadata.md): `attributesSchema` and `childAttributesSchema` hold this type. <!-- id:XA5FqCzv -->
- [Catalogue of types](./schema/types.md): every type in the library.
