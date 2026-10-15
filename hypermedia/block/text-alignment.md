---
name: Text Alignment
summary: "The horizontal alignment of a block's text: left, center, right or justify."
---
**Text alignment** is the optional `textAlignment` attribute of a block: `left`, `center`, `right` or `justify`. `left` is the default. Writers omit the key for `left`, so a block that was never aligned keeps the same attributes and saving it again produces no new [ReplaceBlock](../change/op/replace-block.md). Readers treat a missing key, and any value outside the four, as `left`. <!-- id:wJOtSPEP -->

The key matches the editor's `textAlignment` block prop. Readers apply it to the block's text: paragraphs and headings are aligned. Other block types accept and keep the attribute, but they have no aligned text to show it on yet. <!-- id:defzwtOl -->

# See also <!-- id:NkDEN2ft -->

- [block/paragraph](./paragraph.md): aligned paragraphs. <!-- id:z3Ol0lJ7 -->
- [block/heading](./heading.md): aligned headings. <!-- id:HYxn-TKD -->
- [block/button alignment](./button-alignment.md): a Button's position in its column, a separate attribute. <!-- id:ANMXG2ra -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:DrZquFq3 -->
