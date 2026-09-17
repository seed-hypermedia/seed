---
name: Annotation
summary: "An inline layer over a block's text: a type, one or more code-point ranges, an optional link and inline attributes, used for formatting, links and mentions."
---
An **annotation** is an inline layer over a [block](../block.md)'s text. Formatting, links and mentions are stored as a list of annotations beside the text, and the text itself holds no markup. Each annotation has a `type`, parallel `starts` and `ends` arrays naming one or more ranges (so one annotation can cover several stretches of text), an optional `link`, and any further attributes inline. Offsets count Unicode code points. <!-- id:poGRQvkH -->

The Seed app writes these types: `Bold`, `Italic`, `Underline`, `Strike`, `Code`, `Link` (with `link`), `Embed`, `Range` (a highlight), and `TextColor`, `BackgroundColor`, `TextSize` and `TextFamily` (each with a `value`). `Embed` is an inline [embed](./embed.md) or [mention](../protocol/comments.md): `link` plus `mentionKind` of `account` or `document`, over a single U+FEFF placeholder character in the text. As with blocks, an early comment encoding nested attributes under an `attributes` key, and the daemon reads both forms. See [Blocks](../protocol/blocks.md). <!-- id:DsSfPH0k -->

# See also <!-- id:bkos7jAW -->

- [Blocks](../protocol/blocks.md): annotations in the block model. <!-- id:BEiIYKlZ -->
- [block](../block.md): the block that holds annotations. <!-- id:lfaunIyy -->
- [block/paragraph](./paragraph.md) and [block/heading](./heading.md): the text blocks. <!-- id:0VenA0mx -->
- [Comments](../protocol/comments.md): mentions and citations. <!-- id:SEQeyzsb -->
- [URLs](../protocol/urls.md): the links an annotation carries. <!-- id:cvZ8BkHx -->
