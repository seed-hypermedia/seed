---
name: Heading Block
summary: A section heading.
schemaDefinition: ipfs://bafyreici55nezeopyatqjmcf3tbtlox6hbegfm2cpbzaa5vj7y7uxt4hzq
---
This document describes the **block/heading** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:wmJHjzZa -->

# Shape <!-- id:lCAihj5P -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:2v9m5JN5 -->
  - `type` — `"Heading"` <!-- id:aPgD9CRs -->
  - `text` — [string](../string.md) <!-- id:EA1orVgz -->
  - `annotations` — list of [block/annotation](./annotation.md) <!-- id:VOJAwECN -->
  - `attributes` — map { 2 fields } <!-- id:GvMoQ1bo -->

# Depends on <!-- id:rJp_AZEn -->

- [block/annotation](./annotation.md) <!-- id:rjNj96kD -->
- [block/base](./base.md) <!-- id:OeY-jnQk -->
- [block/children-type](./children-type.md) <!-- id:-ujzzmqw -->
- [any](../any.md) <!-- id:jbfVLj7H -->
- [float](../float.md) <!-- id:uyaQRe-W -->
- [string](../string.md) <!-- id:sjgu9T7j -->
