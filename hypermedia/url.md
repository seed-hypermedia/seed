---
name: URL
summary: "A string holding a URL of any scheme, which `format: url` tells an editor to render as a link and to validate as one."
---
A **URL** is a string that holds a web address of any scheme: `https://…`, `hm://…`, `ipfs://…`. `format: url` marks the string as a URL, so a tool that reads the schema can show it as a link. The [Seed app](./software/desktop.md) shows a plain text field for it, and the validator does not check the shape. <!-- id:TbrRQ-xc -->

Two narrower types exist. A [Hypermedia URL](./hm-url.md) is a reference to a Hypermedia [document](./protocol/documents.md). An [IPFS URL](./ipfs-url.md) is a reference to an object stored by its [CID](./cid.md). Use `url` where any web address is welcome: the `link` of a [block](./protocol/blocks.md), a document's `siteUrl`, the target of a navigation item.

This page defines the **url** type, a value type of [Hypermedia Schemas](./schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type. <!-- id:hx9gaauc -->

# See also <!-- id:GuZo5fUD -->

- [hm-url](./hm-url.md): a reference to a Hypermedia document. <!-- id:uBTlGwij -->
- [ipfs-url](./ipfs-url.md): a reference to a file by CID. <!-- id:fYlGSHsm -->
- [URLs](./protocol/urls.md): the `hm://` scheme and how it maps to the web. <!-- id:EWAs5Sgw -->
- [metadata](./metadata.md): `siteUrl` and the other URL keys. <!-- id:D9GiNvm2 -->
- [navigation item](./metadata/navigation-item.md): a menu entry with a link. <!-- id:sRoRh-ih -->
- [Catalogue of types](./schema/types.md): every type in the library.
