---
name: Heading block
summary: A section heading.
schemaDefinition: ipfs://bafyreid7zlrslpjmj42maprzubq2k5dx2ast47apw2yco37k5sb27z4254
---
This document describes the **schema/block/heading** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:wmJHjzZa -->

# Shape <!-- id:lCAihj5P -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:2v9m5JN5 -->
  - `type` — `"Heading"` <!-- id:aPgD9CRs -->
  - `text` — [string](../string.md) <!-- id:EA1orVgz -->
  - `annotations` — list of [schema/block/annotation](./annotation.md) <!-- id:VOJAwECN -->
  - `attributes` — map { 2 fields } <!-- id:GvMoQ1bo -->

# Depends on <!-- id:rJp_AZEn -->

- [schema/block/annotation](./annotation.md) <!-- id:rjNj96kD -->
- [schema/block/base](./base.md) <!-- id:OeY-jnQk -->
- [schema/block/children-type](./children-type.md) <!-- id:-ujzzmqw -->
- [any](../any.md) <!-- id:jbfVLj7H -->
- [float](../float.md) <!-- id:uyaQRe-W -->
- [string](../string.md) <!-- id:sjgu9T7j -->
