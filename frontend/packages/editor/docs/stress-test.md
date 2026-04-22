---
name: Natural Typography Stress Test
summary:
  A rich document that exercises every block type and inline mark so we can review the new `.hm-prose` rhythm at a
  glance.
---

# Natural Typography Stress Test

A single document that exercises every block type Seed renders, so we can review the new `.hm-prose` rhythm in one
scroll. This top paragraph is the first block after the title heading, testing the heading-to-body gap when a document
opens on a level-1 heading. The lead paragraph should sit naturally below the title — close enough to feel like the same
unit, far enough that the title reads as a title.

A second paragraph, to see what two stacked paragraphs feel like. The gap between them should be small — a breath, not a
break. If this gap feels too cramped or too wide, the base inter-block rhythm needs tuning.

## Headings and sections

Section headings should open more space above than between paragraphs, because they mark a new unit. The gap above this
H2 should feel decisive without shouting.

### Sub-sections

An H3 still marks a break, but a smaller one. It's for grouping paragraphs inside a section.

#### A minor heading

H4 and below ride the body rhythm. Use them sparingly — they're closer to "labels" than "section markers."

## Inline marks in flowing prose

Seed's inline marks should render as plain semantic HTML. **Bold** carries weight without shouting. _Italic_ leans on
emphasis, not decoration. A `code span` should have a subtle background tint and the monospace stack. Strikethrough like
~~this old idea~~ shows a draft in flight. An [external link](https://example.com) picks up the document's link color
and an underline with a healthy offset.

Combinations matter too: **bold with an [inline link](https://example.com)**, _italic with a `code` fragment_, and
**bold _italic_ with a tilde-free draft**. No single mark should fight the others; they should layer.

## Lists

### Unordered lists

- First item, plain.
- Second item with **bold** in the middle.
- Third item with a long run that wraps: a paragraph-length bullet exists to check that the hanging indent and bullet
  marker line up correctly on the second line, which is where list typography usually breaks.
  - Nested bullet one.
  - Nested bullet two, with an [inline link](https://example.com).
    - Double-nested. This should read as part of the same list, not a new one.
- Back to the top level.

### Ordered lists

1. First step — install the plugin.
2. Second step — apply the class.
3. Third step — delete the old rules.
   1. Sub-step: strip per-block overrides.
   2. Sub-step: verify no em-based margin wins specificity over a wrapper rule.
4. Fourth step — review the stress test (this document).

## Blockquote

> When you reach for absolute pixel units, you're coding for today's screen. When you reach for ems, you're coding for
> every screen that renders text at a different size. — Nobody famous, but correct anyway.
>
> A blockquote's second paragraph should sit tight against the first — same quote, same voice. The left border should be
> the only chrome, not a full card.

## Code blocks

A small JavaScript sample:

```js
// A short function is more expressive than a long comment.
function em(multiplier, baseSize = 16) {
  return multiplier * baseSize
}

const h1TopMargin = em(1.6) // 25.6px at default base
```

A TypeScript snippet with comments and generics:

```ts
type BlockType = 'paragraph' | 'heading' | 'code-block' | 'image'

interface HMProseConfig<T extends BlockType> {
  blockType: T
  readonly spacingUnit: 'em' | 'rem'
}

export function scaleToReadable<T extends BlockType>(config: HMProseConfig<T>): number {
  // em scales with the element's own font-size, rem scales with root.
  return config.spacingUnit === 'em' ? 1.6 : 1.25
}
```

A CSS snippet (meta — the rhythm this document is testing):

```css
.hm-prose .blockNode + .blockNode {
  margin-top: 0.375rem;
}

.hm-prose .blockNode:has(> [data-content-type='heading'][data-level='1']) {
  margin-top: 2rem;
}
```

And a shell command, to confirm single-line code blocks don't overflow:

```bash
pnpm --filter desktop dev
```

## Dense paragraph with marks

Consider a paragraph that mixes almost everything: a citation of [the W3C spec](https://www.w3.org/TR/css-text/), a
reference to a function name like `scaleToReadable`, a **bold clause** inside a larger thought, and an _em-phasised
aside — with punctuation_. The reader shouldn't stumble on any of these. If your eye snags on the code span's padding,
the baseline's off.

## Horizontal rule

Above the rule.

---

Below the rule. The rule is a scene break, not a section break — smaller than a heading, larger than a paragraph gap.

## Mixing in media

A paragraph before an image. Media blocks should get a little more breathing room than a paragraph-to-paragraph gap, but
not as much as a heading. The gap below a media block should stay consistent whether the next block is a paragraph,
heading, or another media block.

### Inline image

A paragraph introducing an image. When you drop a real image in this block, check: caption sits tight below the image,
the image doesn't push the next paragraph away more than a normal media gap, and long captions wrap cleanly.

![Inline image placeholder — replace with a real file. Caption text goes here and should wrap across multiple lines to test the caption typography.](./images/placeholder.png)

A follow-up paragraph after the image, to verify the after-media gap.

### Wide image (cover-style)

A paragraph before a wide/cover image. Check that a very wide image doesn't break the surrounding column width and that
the caption stays centered below it.

> _Replace this with a real wide image block. Leave caption empty to test the "no caption" path._

### Image gallery / grid

A paragraph before a multi-image grid. Seed renders side-by-side images inside a `Grid` child container. Replace with a
real 2-column or 3-column image grid to check: gap between grid items, responsive collapse to one column on mobile,
captions per cell.

> _Replace this line with a real grid of 2–4 images to test the Grid layout._

### Video (self-hosted)

A paragraph before a video. Controls (autoplay, loop, muted) should render the same in edit mode as in the published
view. The video should respect aspect ratio and not blow out the column.

> _Replace this line with a real self-hosted video block (e.g. an .mp4 upload)._

### Video (YouTube / iframe)

A paragraph before an embedded YouTube video. The iframe should scale proportionally; the gap above/below should match a
self-hosted video.

> _Replace this line with a real YouTube or Vimeo URL via the video block._

### File attachment

A paragraph before a file attachment. The file block should render as a downloadable card with an icon, file name, and
byte size.

> _Replace this line with a real file block (drop a PDF or a .zip)._

## Embeds

### Document embed — Card view

A paragraph before a Card-view embed. The card should show title, summary, thumbnail (if any), and sit with the same
rhythm as a media block.

> _Replace this line with a real `hm://…` document embed in Card view._

### Document embed — Content view

A paragraph before a Content-view embed. This one renders the embedded document's actual blocks inline. Nested
`.hm-prose` should NOT double-margin at the boundary — the inner document picks up the same rhythm.

> _Replace this line with a real `hm://…` document embed in Content view._

### Document embed — Fragment range

A paragraph before a fragment embed. When an embed points at a sub-span of a source block, the surrounding text should
collapse and the quoted span should show with `…` on either side.

> _Replace this line with a real `hm://…/#blockref?s=<start>&e=<end>` fragment embed._

### Comments embed

A paragraph before a Comments-view embed. This surfaces the comment thread of another document inline. Check that nested
comment threads render with the tighter comment rhythm (sans stack) while the host document keeps its serif body.

> _Replace this line with a real `hm://…` document embed in Comments view._

### Web embed — Tweet / X post

A paragraph before an X (Twitter) post embed. These use their own `.x-post-container` scoped theme.

> _Replace this line with a real X post URL via the web-embed block._

### Web embed — Instagram

A paragraph before an Instagram embed. Instagram's script-driven card should render without fighting the surrounding
column.

> _Replace this line with a real Instagram post URL via the web-embed block._

### Math block

A paragraph before a math block. KaTeX-rendered math should align vertically with surrounding text.

> _Replace this line with a real math block containing e.g. `$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$`._

### Button block

A paragraph before a button block. The button should use the design-system primary style and align according to its
alignment attribute.

> _Replace this line with a real button block (call-to-action with a link)._

### Query block

A paragraph before a Query block. Query blocks render a live list or grid of documents matching a filter.

> _Replace this line with a real query block (e.g. "documents in this space, sorted by updated-first")._

## Nested structure

Sometimes a document holds a heading inside a deeper nest — for example, a block that contains a list that contains a
heading.

1. Top-level item.
   - Nested unordered.
     > A blockquote three levels deep. Rare, but should still render correctly.
2. Second top-level item.

## Closing

A plain paragraph at the end of the document, to check that the document doesn't spring any bonus margin below the last
block. The body should end cleanly.
