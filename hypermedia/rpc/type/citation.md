---
name: Citation
summary: "One mention of a target resource from elsewhere on the network: the citing document or comment, whether it pinned an exact version, and the fragment it points at."
---
One mention of a target [resource](../../glossary.md) from elsewhere on the network. It holds the citing source, a document `d` or a comment `c`, whether it pinned the exact [version](../../protocol/documents.md), and the [fragment](./parsed-fragment.md) it points at. Clients build it from a [raw citation](./raw-citation.md). <!-- id:vp-ojCpz -->

This page describes the **rpc/type/citation** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:MOh8ryRo -->

# See also <!-- id:J5kPflAX -->

- [Comments](../../protocol/comments.md): citations, mentions and backlinks. <!-- id:PBXKYcSB -->
- [ListCitations](../list-citations.md): the method that lists citations. <!-- id:HpZTJgef -->
- [Raw Citation](./raw-citation.md): the indexed form. <!-- id:2oXCTCWh -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:Xq4QyZ3J -->
