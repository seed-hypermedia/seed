---
name: Redirect Target
summary: The destination carried by a redirect Ref, a space and path to send readers to, with a republish flag that keeps the content showing under the old address.
schemaDefinition: ipfs://bafyreihqm4tl6kvexfsed2gohvvzg3qhthcdxhwo7k3xdmd5i26xqqam3y
---
A **redirect target** is where a redirect [Ref](../ref.md) sends readers. When a [document](../protocol/documents.md) moves, links made before the move still resolve through it. <!-- id:yW0sBFya -->

This page defines the **ref/redirect-target** struct used by a redirecting Ref. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:BDVJInYn -->

`path` is the destination path. `space` is the destination space, omitted when the redirect stays within the same space. `republish` changes the meaning of the Ref. Without it, the Ref is a move and the old address counts as deleted: readers get a redirect result and listings drop it. With it, the old address is a **republish** that keeps appearing in listings and search and shows the target's content under its own URL. A chain of redirects is followed up to a small hop limit, and a cycle is refused. Editing an address that holds a redirect builds on the target's history and takes the address over with a higher generation. See [Documents](../protocol/documents.md). <!-- id:LeKLUozu -->

# Shape <!-- id:Mw7vaa0_ -->

A **closed struct** with these fields: <!-- id:vOHPKMNt -->
  - `space`: [principal](../principal.md) <!-- id:BX1XxAo1 -->
  - `path`: [string](../string.md) <!-- id:tkiZCNDO -->
  - `republish`: [boolean](../boolean.md) <!-- id:f8ILSJ4c -->

# Depends on <!-- id:n0grsHmb -->

- [principal](../principal.md) <!-- id:dMEzYQIO -->
- [boolean](../boolean.md) <!-- id:zkw60tb9 -->
- [string](../string.md) <!-- id:jyHqppJd -->

# See also

- [ref](../ref.md): the three shapes of a Ref.
- [Documents](../protocol/documents.md): moving, redirecting and generations.
- [ResourceRedirect](../rpc/type/resource-redirect.md): what readers get back.
- [URLs](../protocol/urls.md): addresses and paths.
