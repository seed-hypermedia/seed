---
name: Embed Block
summary: An embed of another Hypermedia document, block or text range by hm:// link, rendered as content, a card, its comments or a link.
---
An **embed block** shows another Hypermedia resource in place. `link` is required and is an `hm://` URL. It may pin a [version](../protocol/documents.md) with `?v=`, follow the latest with `&l`, and narrow the target to a block (`#id`), a block with its children (`#id+`) or a text range (`#id[start:end]`); see [URLs](../protocol/urls.md). The `view` attribute is an [embed view](./embed-view.md): `Content`, `Card`, `Comments` or `Link`. A block [comment](../protocol/comments.md) is a comment whose body starts with an Embed of the quoted block. Renderers detect cycles and fall back to a link. <!-- id:JhjWHYAl -->

# Opening an embed

In desktop and web readers, including mobile web, clicking a document block embed opens its document if needed and scrolls to the referenced block. This also applies to document embeds inside comments. Clicking the same reference again scrolls to the block again, even when the URL has not changed. If the referenced block no longer exists in the latest version, the reader opens the newest version that still contains it, or the version the embed pins.

A document embed without a block reference opens the document if needed. If that document is already open, the reader keeps its current scroll position.

A comment embed opens the target document and its comment thread, then reveals, scrolls to, and highlights the exact comment or reply. Clicking it again repeats the scroll. A comment fragment also retains its pinned comment version and text selection.

If the target is missing after loading, the reader shows “Block not found” or “Comment not found”. It opens the target document if needed and preserves the reading position when that document is already open.

# See also <!-- id:ldJnc_09 -->

- [block/embed-view](./embed-view.md): the four ways an embed renders. <!-- id:ytqj8q9- -->
- [URLs](../protocol/urls.md): block references, text ranges and versions. <!-- id:X6NHJqas -->
- [block/web-embed](./web-embed.md) and [block/nostr](./nostr.md): embeds of outside content. <!-- id:3K6oQ8Ee -->
- [block/query](./query.md): a live list of documents. <!-- id:h4_0MTy1 -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:ZjiArTT_ -->
