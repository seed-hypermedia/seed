---
name: Core block
summary: The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn,
schemaDefinition: ipfs://bafyreif7kagirwaczrjsnxv2jniihbvcm2hc4c2nsdcwqg5qgjbxtxhzom
---
The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn, Query). This is the strict core Hypermedia defines; anyone can extend it by making a larger union that includes it plus their own block types. <!-- id:38pY0Ovx -->

This document describes the **schema/block/core** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:MKlfmMqt -->

# Shape <!-- id:3vJCYHye -->

A **union** — a value matches one of these variants: <!-- id:k29A1dG- -->
  - [schema/block/paragraph](./paragraph.md) <!-- id:fW1wQHLx -->
  - [schema/block/heading](./heading.md) <!-- id:75e1rNp2 -->
  - [schema/block/code](./code.md) <!-- id:7Ec0B_-v -->
  - [schema/block/math](./math.md) <!-- id:QDycSCAv -->
  - [schema/block/image](./image.md) <!-- id:x4aS8q5D -->
  - [schema/block/video](./video.md) <!-- id:TvkBIH9a -->
  - [schema/block/file](./file.md) <!-- id:wwjUU6fC -->
  - [schema/block/button](./button.md) <!-- id:sb8WZ95W -->
  - [schema/block/embed](./embed.md) <!-- id:KJCJBVDD -->
  - [schema/block/web-embed](./web-embed.md) <!-- id:ABQQB7N2 -->
  - [schema/block/nostr](./nostr.md) <!-- id:6ExFE8P8 -->
  - [schema/block/table](./table.md) <!-- id:-L7Iz0oX -->
  - [schema/block/table-row](./table-row.md) <!-- id:yOaWDqYC -->
  - [schema/block/table-column](./table-column.md) <!-- id:ljw-Ub92 -->
  - [schema/block/query](./query.md) <!-- id:9J2S1IJf -->

# Depends on <!-- id:JBcAio2a -->

- [schema/block/button](./button.md) <!-- id:95PkR0Va -->
- [schema/block/code](./code.md) <!-- id:DoP-3lbb -->
- [schema/block/embed](./embed.md) <!-- id:UfVtGs18 -->
- [schema/block/file](./file.md) <!-- id:Ow6Vn6_c -->
- [schema/block/heading](./heading.md) <!-- id:meGTMyiV -->
- [schema/block/image](./image.md) <!-- id:doCZBWWs -->
- [schema/block/math](./math.md) <!-- id:0MMgVlyZ -->
- [schema/block/nostr](./nostr.md) <!-- id:SI8QCc3A -->
- [schema/block/paragraph](./paragraph.md) <!-- id:W3kzTSxB -->
- [schema/block/query](./query.md) <!-- id:WrG0RsBf -->
- [schema/block/table](./table.md) <!-- id:HSmtp1t4 -->
- [schema/block/table-column](./table-column.md) <!-- id:PrKyJUKP -->
- [schema/block/table-row](./table-row.md) <!-- id:JeH5fZ83 -->
- [schema/block/video](./video.md) <!-- id:ZxfdkwxA -->
- [schema/block/web-embed](./web-embed.md) <!-- id:yFyvlYFu -->
