---
name: Core Block
summary: The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn,
schemaDefinition: ipfs://bafyreihgw4nkzdyw2gihycgvwofrq4ki5t4fkmtvrzc5ti7kij5bcm4zwe
---
The union of the fifteen built-in block types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn, Query). This is the strict core Hypermedia defines; anyone can extend it by making a larger union that includes it plus their own block types. <!-- id:38pY0Ovx -->

This document describes the **block/core** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:MKlfmMqt -->

# Shape <!-- id:3vJCYHye -->

A **union** — a value matches one of these variants: <!-- id:k29A1dG- -->
  - [block/paragraph](./paragraph.md) <!-- id:fW1wQHLx -->
  - [block/heading](./heading.md) <!-- id:75e1rNp2 -->
  - [block/code](./code.md) <!-- id:7Ec0B_-v -->
  - [block/math](./math.md) <!-- id:QDycSCAv -->
  - [block/image](./image.md) <!-- id:x4aS8q5D -->
  - [block/video](./video.md) <!-- id:TvkBIH9a -->
  - [block/file](./file.md) <!-- id:wwjUU6fC -->
  - [block/button](./button.md) <!-- id:sb8WZ95W -->
  - [block/embed](./embed.md) <!-- id:KJCJBVDD -->
  - [block/web-embed](./web-embed.md) <!-- id:ABQQB7N2 -->
  - [block/nostr](./nostr.md) <!-- id:6ExFE8P8 -->
  - [block/table](./table.md) <!-- id:-L7Iz0oX -->
  - [block/table-row](./table-row.md) <!-- id:yOaWDqYC -->
  - [block/table-column](./table-column.md) <!-- id:ljw-Ub92 -->
  - [block/query](./query.md) <!-- id:9J2S1IJf -->

# Depends on <!-- id:JBcAio2a -->

- [block/button](./button.md) <!-- id:95PkR0Va -->
- [block/code](./code.md) <!-- id:DoP-3lbb -->
- [block/embed](./embed.md) <!-- id:UfVtGs18 -->
- [block/file](./file.md) <!-- id:Ow6Vn6_c -->
- [block/heading](./heading.md) <!-- id:meGTMyiV -->
- [block/image](./image.md) <!-- id:doCZBWWs -->
- [block/math](./math.md) <!-- id:0MMgVlyZ -->
- [block/nostr](./nostr.md) <!-- id:SI8QCc3A -->
- [block/paragraph](./paragraph.md) <!-- id:W3kzTSxB -->
- [block/query](./query.md) <!-- id:WrG0RsBf -->
- [block/table](./table.md) <!-- id:HSmtp1t4 -->
- [block/table-column](./table-column.md) <!-- id:PrKyJUKP -->
- [block/table-row](./table-row.md) <!-- id:JeH5fZ83 -->
- [block/video](./video.md) <!-- id:ZxfdkwxA -->
- [block/web-embed](./web-embed.md) <!-- id:yFyvlYFu -->
