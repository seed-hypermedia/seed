---
name: Redirect Target
summary: The destination carried by a redirect Ref, a space and path to send readers to, with a republish flag that keeps the content showing under the old address.
---
A **redirect target** is where a redirect [Ref](../ref.md) sends readers. When a [document](../protocol/documents.md) moves, links made before the move still resolve through it. <!-- id:yW0sBFya -->

This page defines the **ref/redirect-target** struct used by a redirecting Ref. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:BDVJInYn -->

`path` is the destination path. `space` is the destination space, omitted when the redirect stays within the same space. `republish` changes the meaning of the Ref. Without it, the Ref is a move and the old address counts as deleted: readers get a redirect result and listings drop it. With it, the old address is a **republish** that keeps appearing in listings and search and shows the target's content under its own URL. A chain of redirects is followed up to a small hop limit, and a cycle is refused. Editing an address that holds a redirect builds on the target's history and takes the address over with a higher generation. See [Documents](../protocol/documents.md). <!-- id:LeKLUozu -->

# See also <!-- id:pgpFBhsR -->

- [ref](../ref.md): the three shapes of a Ref. <!-- id:YGwW5Sh9 -->
- [Documents](../protocol/documents.md): moving, redirecting and generations. <!-- id:YALZHLsh -->
- [ResourceRedirect](../rpc/type/resource-redirect.md): what readers get back. <!-- id:2LuMY9pb -->
- [URLs](../protocol/urls.md): addresses and paths. <!-- id:_nSNVMLf -->
