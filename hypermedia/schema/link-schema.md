---
name: Link schema
summary: The variant for a link (a CID), which can name the type it expects to point at.
---
A link schema types a [CID](../cid.md) that points at a separate block. The optional `target` names the schema the linked block should conform to. The target is advisory: a validator does not fetch the linked block to check it. [References and naming](./references.md) compares links with includes. <!-- id:rGScVXer -->

This document describes the **schema/link-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:QZ0YT6sU -->

# See also <!-- id:mgCyt067 -->

- [References and naming](./references.md): include versus link, and why references are names. <!-- id:nbO7094t -->
- [Link](../link.md): the link kind. <!-- id:Ups-JrBV -->
- [CID](../cid.md): the content identifier a link holds. <!-- id:O_aYThL4 -->
- [Blobs](../protocol/blobs.md): the content-addressed objects links point at. <!-- id:89NCKuky -->
- [Include schema](./include-schema.md): embeds a shape where a link points across blocks. <!-- id:btZ70VC4 -->
