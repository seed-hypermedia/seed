---
name: Core Block
summary: "The strict union of the fifteen built-in block types; extend it with your own types by making a larger union that includes it."
schemaDefinition: ipfs://bafyreidjmvkidd6iorhrdnavyqfnhdzoaxfemx56fwlzqtbo5rebqnbbry
---
**Core Block** is the union of the fifteen built-in [block](../block.md) types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn, Query). It is the strict core Hypermedia defines. Anyone can extend it by making a larger union that includes it plus their own block types. <!-- id:38pY0Ovx -->

The Seed app also knows `Slot` (an invisible container for top-level lists and grids), `Link` (a [navigation menu item](../metadata/navigation-item.md)) and the legacy `Group`, which are not part of this union. Anything else still parses as the open block. [Blocks](../protocol/blocks.md) has one line per type, with its attributes.

# Shape <!-- id:3vJCYHye -->

A **union**. A value matches one of these variants: <!-- id:k29A1dG- -->
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

# See also

- [Blocks](../protocol/blocks.md): every built-in type with its attributes.
- [block](../block.md): the open block that accepts unknown types.
- [block/base](./base.md): the base a new type extends.
- [Example: app block](../example/app-block.md): a larger union that includes the core.
