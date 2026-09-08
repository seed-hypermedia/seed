---
name: Heading block
summary: A section heading.
schemaDefinition: ipfs://bafyreiff4jittqzcz3plymmwtocsww334hotqmyoj3ogkvt74yoq2jigmq
---
This document describes the **hypermedia-block-heading** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:wmJHjzZa -->

# Shape <!-- id:lCAihj5P -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:2v9m5JN5 -->
  - `type` — `"Heading"` <!-- id:aPgD9CRs -->
  - `text` — [string](./hypermedia-string.md) <!-- id:EA1orVgz -->
  - `annotations` — list of [hypermedia-annotation](./hypermedia-annotation.md) <!-- id:VOJAwECN -->
  - `attributes` — map { 2 fields } <!-- id:GvMoQ1bo -->

# Depends on <!-- id:rJp_AZEn -->

- [hypermedia-annotation](./hypermedia-annotation.md) <!-- id:rjNj96kD -->
- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:OeY-jnQk -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:-ujzzmqw -->
- [any](./hypermedia-any.md) <!-- id:jbfVLj7H -->
- [float](./hypermedia-float.md) <!-- id:uyaQRe-W -->
- [string](./hypermedia-string.md) <!-- id:sjgu9T7j -->
