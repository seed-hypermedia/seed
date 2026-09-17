---
name: Embed Block
summary: An embed of another Hypermedia document, block or text range by hm:// link, rendered as content, a card, its comments or a link.
---
An **embed block** shows another Hypermedia resource in place. `link` is required and is an `hm://` URL. It may pin a [version](../protocol/documents.md) with `?v=`, follow the latest with `&l`, and narrow the target to a block (`#id`), a block with its children (`#id+`) or a text range (`#id[start:end]`); see [URLs](../protocol/urls.md). The `view` attribute is an [embed view](./embed-view.md): `Content`, `Card`, `Comments` or `Link`. A block [comment](../protocol/comments.md) is a comment whose body starts with an Embed of the quoted block. Renderers detect cycles and fall back to a link. <!-- id:JhjWHYAl -->

# See also <!-- id:ldJnc_09 -->

- [block/embed-view](./embed-view.md): the four ways an embed renders. <!-- id:ytqj8q9- -->
- [URLs](../protocol/urls.md): block references, text ranges and versions. <!-- id:X6NHJqas -->
- [block/web-embed](./web-embed.md) and [block/nostr](./nostr.md): embeds of outside content. <!-- id:3K6oQ8Ee -->
- [block/query](./query.md): a live list of documents. <!-- id:h4_0MTy1 -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:ZjiArTT_ -->
