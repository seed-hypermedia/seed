---
name: URL
summary: "A string holding a URL of any scheme, which `format: url` tells an editor to render as a link and to validate as one."
schemaDefinition: ipfs://bafyreib6hcm2zqfnqwcw54q4e4ittvehhaklfh2nnm6ed7yenop3hqonbi
---
A **URL** is a string holding a URL of any scheme: `https://…`, `hm://…`, `ipfs://…`. `format: url` tells an editor to render it as a link and to check the shape, instead of showing a plain text field. The narrower [Resource URL](./hm-url.md) and [IPFS URL](./ipfs-url.md) types name a reference to a Hypermedia document or to a content-addressed object. Use `url` where any web address is welcome: a block's `link`, a document's `siteUrl`, a navigation item's target. <!-- id:TbrRQ-xc -->

This page describes the **url** type, a value type of [Hypermedia Schemas](./schema.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:hx9gaauc -->

# Shape <!-- id:M8rJ_Gnn -->

Kind: `string`. <!-- id:Pj-VXb-Q -->

# See also

- [hm-url](./hm-url.md): a reference to a Hypermedia document.
- [ipfs-url](./ipfs-url.md): a reference to a file by CID.
- [URLs](./protocol/urls.md): the `hm://` scheme and how it maps to the web.
- [metadata](./metadata.md): `siteUrl` and the other URL keys.
- [navigation item](./metadata/navigation-item.md): a menu entry with a link.
