---
name: Link schema
summary: The variant for a link (a CID), which can name the type it expects to point at.
---
A link schema describes a [link](../link.md): a [CID](../cid.md) that points at a separate stored object. The optional `target` names the schema that the linked object should match. The target is advice only. A validator does not fetch the linked object to check it. [References and naming](./references.md) compares links with includes. <!-- id:rGScVXer -->

This page defines the **schema/link-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:QZ0YT6sU -->

# See also <!-- id:mgCyt067 -->

- [References and naming](./references.md): include versus link, and why references are names. <!-- id:nbO7094t -->
- [Link](../link.md): the link kind. <!-- id:Ups-JrBV -->
- [CID](../cid.md): the content identifier a link holds. <!-- id:O_aYThL4 -->
- [Blobs](../protocol/blobs.md): the content-addressed objects links point at. <!-- id:89NCKuky -->
- [Include schema](./include-schema.md): copies a shape, where a link points at another object. <!-- id:btZ70VC4 -->
