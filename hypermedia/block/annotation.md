---
name: Annotation
summary: "An inline layer over a block's text: a type, one or more code-point ranges, an optional link and inline attributes, used for formatting, links and mentions."
schemaDefinition: ipfs://bafyreiacbskofr2t3bzpbrmsf265lh5oyhb6trmz3qbvflsbgpbmv74dw4
---
An **annotation** is an inline layer over a [block](../block.md)'s text. Formatting, links and mentions are stored as a list of annotations beside the text, and the text itself holds no markup. Each annotation has a `type`, parallel `starts` and `ends` arrays naming one or more ranges (so one annotation can cover several stretches of text), an optional `link`, and any further attributes inline. Offsets count Unicode code points.

The Seed app writes these types: `Bold`, `Italic`, `Underline`, `Strike`, `Code`, `Link` (with `link`), `Embed`, `Range` (a highlight), and `TextColor`, `BackgroundColor`, `TextSize` and `TextFamily` (each with a `value`). `Embed` is an inline [embed](./embed.md) or [mention](../protocol/comments.md): `link` plus `mentionKind` of `account` or `document`, over a single U+FEFF placeholder character in the text. As with blocks, an early comment encoding nested attributes under an `attributes` key, and the daemon reads both forms. See [Blocks](../protocol/blocks.md).

# Shape <!-- id:khrAA7LZ -->

A map with these fields: <!-- id:bMk3d1tZ -->
  - `type`: [string](../string.md) <!-- id:a1TPf35c -->
  - `link`: [string](../string.md) <!-- id:rq09OGe_ -->
  - `starts`: list of [integer](../integer.md) <!-- id:2e_csJ9j -->
  - `ends`: list of [integer](../integer.md) <!-- id:FCMIb0ht -->

# Depends on <!-- id:e4_snnas -->

- [value](../value.md) <!-- id:7CFu_PC8 -->
- [integer](../integer.md) <!-- id:3JNyZx61 -->
- [string](../string.md) <!-- id:_RMX_0uo -->

# See also

- [Blocks](../protocol/blocks.md): annotations in the block model.
- [block](../block.md): the block that holds annotations.
- [block/paragraph](./paragraph.md) and [block/heading](./heading.md): the text blocks.
- [Comments](../protocol/comments.md): mentions and citations.
- [URLs](../protocol/urls.md): the links an annotation carries.
