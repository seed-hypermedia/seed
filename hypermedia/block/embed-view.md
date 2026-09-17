---
name: Embed View
summary: "How an Embed block renders its target: the content itself, a card, its discussion, or a plain link."
schemaDefinition: ipfs://bafyreiakvbosqv7cyvhaetqpcdgjok3tr2fabqov3kl42f2vdiqvc75e2e
---
The **embed view** is the `view` of an [embed](./embed.md). `Content` renders the target's body inline. `Card` shows its title, summary and cover. `Comments` shows its [discussion](../protocol/comments.md). `Link` shows a plain link.

# Shape <!-- id:zw6uZukZ -->

Kind: `string`. One of: `Content`, `Card`, `Comments`, `Link`. <!-- id:tybrOd_y -->

# See also

- [block/embed](./embed.md): the block that uses this value.
- [Blocks](../protocol/blocks.md): embeds in the block model.
- [URLs](../protocol/urls.md): what an embed can point at.
