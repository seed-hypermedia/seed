---
name: Heading Block
summary: "A section heading whose children are the section; the heading level comes from nesting, not from an attribute."
schemaDefinition: ipfs://bafyreici55nezeopyatqjmcf3tbtlox6hbegfm2cpbzaa5vj7y7uxt4hzq
---
A heading with `text` and [annotations](./annotation.md). There is no level attribute: a heading's depth is its nesting depth, and the blocks under it are its section, laid out by `childrenType` and `columnCount`. In the markdown dialect a heading's children sit at its indentation until the next heading of the same level.

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
