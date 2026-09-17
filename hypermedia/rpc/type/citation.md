---
name: Citation
summary: "One mention of a target resource from elsewhere on the network: the citing document or comment, whether it pinned an exact version, and the fragment it points at."
schemaDefinition: ipfs://bafyreif2zx7kevtj753643osrtnybp3xskvmvcoeefsehzenk6k7aetlje
---
One mention of a target [resource](../../glossary.md) from elsewhere on the network. It holds the citing source, a document `d` or a comment `c`, whether it pinned the exact [version](../../protocol/documents.md), and the [fragment](./parsed-fragment.md) it points at. Clients build it from a [raw citation](./raw-citation.md). <!-- id:vp-ojCpz -->

This page describes the **rpc/type/citation** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:MOh8ryRo -->

# Shape <!-- id:rbyri4dZ -->

A **closed struct** with these fields: <!-- id:VmqoRbRO -->
  - `source` _(required)_: one of map { 4 fields } | map { 4 fields } <!-- id:MdIAs04J -->
  - `isExactVersion` _(required)_: [boolean](../../boolean.md) <!-- id:UJZmjhTF -->
  - `targetFragment` _(required)_: one of [rpc/type/parsed-fragment](./parsed-fragment.md) | [null](../../null.md) <!-- id:wzdqS34J -->
  - `targetId` _(required)_: [rpc/type/id](./id.md) <!-- id:StfBx79G -->

# Depends on <!-- id:DfdIjFgi -->

- [timestamp](../../timestamp.md) <!-- id:qmlMMX_K -->
- [boolean](../../boolean.md) <!-- id:bMN0_lDm -->
- [null](../../null.md) <!-- id:y97zthBM -->
- [string](../../string.md) <!-- id:Ecgkvu07 -->
- [rpc/type/id](./id.md) <!-- id:ZVKjgJT0 -->
- [rpc/type/parsed-fragment](./parsed-fragment.md) <!-- id:sJ6YEHCt -->

# See also

- [Comments](../../protocol/comments.md): citations, mentions and backlinks.
- [ListCitations](../list-citations.md): the method that lists citations.
- [Raw Citation](./raw-citation.md): the indexed form.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
