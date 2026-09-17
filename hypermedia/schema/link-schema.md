---
name: Link schema
summary: The variant for a link (a CID), which can name the type it expects to point at.
schemaDefinition: ipfs://bafyreiccfyymewyyabv7lkpwqli47wqzji4izbfvinb5rr64o7ovty3ebm
---
A link schema types a [CID](../cid.md) that points at a separate block. The optional `target` names the schema the linked block should conform to. The target is advisory: a validator does not fetch the linked block to check it. [References and naming](./references.md) compares links with includes.

This document describes the **schema/link-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:QZ0YT6sU -->

# Shape <!-- id:oZ8Ewg1C -->

A **closed struct** with these fields: <!-- id:f0WtHHnG -->
  - `type` _(required)_: `"link"` <!-- id:aINr0L9m -->
  - `target`: `string` (the schema the linked block should conform to) <!-- id:9EpX2r1A -->
  - `name`: `string` <!-- id:l3kcRCy0 -->
  - `description`: `string` <!-- id:X1qTBkc0 -->
  - `params`: map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:WvvPXIYj -->

# Depends on <!-- id:ZrXqrtqn -->

- [schema](../schema.md) <!-- id:zSD-j6tg -->

# See also

- [References and naming](./references.md): include versus link, and why references are names.
- [Link](../link.md): the link kind.
- [CID](../cid.md): the content identifier a link holds.
- [Blobs](../protocol/blobs.md): the content-addressed objects links point at.
- [Include schema](./include-schema.md): embeds a shape where a link points across blocks.
