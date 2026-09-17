---
name: URL
summary: "A string holding a URL of any scheme, which `format: url` tells an editor to render as a link and to validate as one."
schemaDefinition: ipfs://bafyreib6hcm2zqfnqwcw54q4e4ittvehhaklfh2nnm6ed7yenop3hqonbi
---
**URL**: a string holding a URL of any scheme: `https://…`, `hm://…`, `ipfs://…`. `format: url` tells an editor to render it as a link and to check the shape, instead of a plain text field. The narrower [Resource URL](./hm-url.md) and [IPFS URL](./ipfs-url.md) types name a reference to a Hypermedia document or to a content-addressed object; use `url` where any web address is welcome — a block's `link`, a document's `siteUrl`, a navigation item's target. <!-- id:TbrRQ-xc -->

This page describes the **url** type — a value type of Hypermedia Schemas. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:hx9gaauc -->

# Shape <!-- id:M8rJ_Gnn -->

Kind: `string`. <!-- id:Pj-VXb-Q -->
