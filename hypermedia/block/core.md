---
name: Core Block
summary: The strict union of the fifteen built-in block types; extend it with your own types by making a larger union that includes it.
---
**Core Block** is the union of the fifteen built-in [block](../block.md) types (Paragraph, Heading, Code, Math, Image, Video, File, Button, Embed, WebEmbed, Nostr, Table, TableRow, TableColumn, Query). It is the strict core Hypermedia defines. Anyone can extend it by making a larger union that includes it plus their own block types. <!-- id:38pY0Ovx -->

The Seed app also knows `Slot` (an invisible container for top-level lists and grids), `Link` (a [navigation menu item](../metadata/navigation-item.md)) and the legacy `Group`, which are not part of this union. Anything else still parses as the open block. [Blocks](../protocol/blocks.md) has one line per type, with its attributes. <!-- id:kAeT6_fu -->

# See also <!-- id:2AGhM2dz -->

- [Blocks](../protocol/blocks.md): every built-in type with its attributes. <!-- id:FQT_KByv -->
- [block](../block.md): the open block that accepts unknown types. <!-- id:jBJI0z-E -->
- [block/base](./base.md): the base a new type extends. <!-- id:JeNgjck4 -->
- [Example: app block](../example/app-block.md): a larger union that includes the core. <!-- id:OkX1XV1T -->
