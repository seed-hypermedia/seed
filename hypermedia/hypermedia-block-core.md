---
name: Core block
summary: The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn,
schemaDefinition: ipfs://bafyreib7xvapsuzymnwbgp37wqh6uqrkelkybd5kgxozqsetb4iryug7nq
---
The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn, Query). This is the strict core Hypermedia defines; anyone can extend it by making a larger union that includes it plus their own block types. <!-- id:38pY0Ovx -->

This document describes the **hypermedia-block-core** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:MKlfmMqt -->

# Shape <!-- id:3vJCYHye -->

A **union** — a value matches one of these variants: <!-- id:k29A1dG- -->
  - [hypermedia-block-paragraph](./hypermedia-block-paragraph.md) <!-- id:fW1wQHLx -->
  - [hypermedia-block-heading](./hypermedia-block-heading.md) <!-- id:75e1rNp2 -->
  - [hypermedia-block-code](./hypermedia-block-code.md) <!-- id:7Ec0B_-v -->
  - [hypermedia-block-math](./hypermedia-block-math.md) <!-- id:QDycSCAv -->
  - [hypermedia-block-image](./hypermedia-block-image.md) <!-- id:x4aS8q5D -->
  - [hypermedia-block-video](./hypermedia-block-video.md) <!-- id:TvkBIH9a -->
  - [hypermedia-block-file](./hypermedia-block-file.md) <!-- id:wwjUU6fC -->
  - [hypermedia-block-button](./hypermedia-block-button.md) <!-- id:sb8WZ95W -->
  - [hypermedia-block-embed](./hypermedia-block-embed.md) <!-- id:KJCJBVDD -->
  - [hypermedia-block-web-embed](./hypermedia-block-web-embed.md) <!-- id:ABQQB7N2 -->
  - [hypermedia-block-nostr](./hypermedia-block-nostr.md) <!-- id:6ExFE8P8 -->
  - [hypermedia-block-table](./hypermedia-block-table.md) <!-- id:-L7Iz0oX -->
  - [hypermedia-block-table-row](./hypermedia-block-table-row.md) <!-- id:yOaWDqYC -->
  - [hypermedia-block-table-column](./hypermedia-block-table-column.md) <!-- id:ljw-Ub92 -->
  - [hypermedia-block-query](./hypermedia-block-query.md) <!-- id:9J2S1IJf -->

# Depends on <!-- id:JBcAio2a -->

- [hypermedia-block-button](./hypermedia-block-button.md) <!-- id:95PkR0Va -->
- [hypermedia-block-code](./hypermedia-block-code.md) <!-- id:DoP-3lbb -->
- [hypermedia-block-embed](./hypermedia-block-embed.md) <!-- id:UfVtGs18 -->
- [hypermedia-block-file](./hypermedia-block-file.md) <!-- id:Ow6Vn6_c -->
- [hypermedia-block-heading](./hypermedia-block-heading.md) <!-- id:meGTMyiV -->
- [hypermedia-block-image](./hypermedia-block-image.md) <!-- id:doCZBWWs -->
- [hypermedia-block-math](./hypermedia-block-math.md) <!-- id:0MMgVlyZ -->
- [hypermedia-block-nostr](./hypermedia-block-nostr.md) <!-- id:SI8QCc3A -->
- [hypermedia-block-paragraph](./hypermedia-block-paragraph.md) <!-- id:W3kzTSxB -->
- [hypermedia-block-query](./hypermedia-block-query.md) <!-- id:WrG0RsBf -->
- [hypermedia-block-table](./hypermedia-block-table.md) <!-- id:HSmtp1t4 -->
- [hypermedia-block-table-column](./hypermedia-block-table-column.md) <!-- id:PrKyJUKP -->
- [hypermedia-block-table-row](./hypermedia-block-table-row.md) <!-- id:JeH5fZ83 -->
- [hypermedia-block-video](./hypermedia-block-video.md) <!-- id:ZxfdkwxA -->
- [hypermedia-block-web-embed](./hypermedia-block-web-embed.md) <!-- id:yFyvlYFu -->
