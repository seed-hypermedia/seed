---
name: Links and Citations
summary: Every hm:// link in a document, a comment or an attribute is indexed as a citation, and this page explains links, backlinks, block citations and mentions.
---
A Hypermedia link is an [`hm://` URL](./urls.md). When one page links another, the linked page can show who links to it. A link to a person is a mention, and it reaches that person. All of this works because a node indexes every link it sees.

Links appear in several places: in a [block](./blocks.md) as the block's `link`, in inline annotations, in embeds, in [comment](./comments.md) bodies and in [metadata](../metadata.md) attributes. The index gives each [resource](../glossary.md) its backlinks: the list of links that point at it. This page covers the index and what is built on it.

# Citations and backlinks <!-- id:fvUUw6AL -->

A citation is one indexed link. Every `hm://` link the [daemon](../software/daemon.md) meets while indexing becomes a link record from the source [blob](./blobs.md) to the target [resource](../glossary.md). The link can sit in a [document](./documents.md) [block](./blocks.md), an annotation, or a comment body. <!-- id:cQdIVT1x -->

- The record is tagged with the source block, the fragment and the version.
- A link with a pinned version is marked as exact. A link that follows the latest marks its version as a suggested minimum.
- `ListCitations` on a target returns these records as citations, ordered by when the citing blob arrived locally. The order ignores the time the blob claims. So an old blob that arrives late can never hide a newer citation on the next page.
- Four links from one version count as four citations.
- For a comment citation, `sourceDocument` is the document the comment was written on (its target at write time). It is not the document the comment links to. So a comment elsewhere that mentions a page shows up among that page's connections, grouped under its own document.

The `ListEntityMentions` call is deprecated. Use `ListCitations`. <!-- id:s094t8hZ -->

# Block citations

A link with a block fragment cites that block. A block [comment](./comments.md) quotes its target this way, so it shows up as a citation of the block. A block's citation count is one per citing block. So a paper that cites one bibliography entry from four paragraphs shows 4 on that entry. A citation of a block records the revision it saw, so a reader can tell whether the cited text has changed since.

# Mentions <!-- id:10Yi4m0f -->

A mention is an inline embed that names a person or a page. It is an `Embed` annotation over a placeholder character in a block's text. Its `mentionKind` is `account` or `document`, and its link points at the person or the page. Documents and comments use the same mechanism, described in [Blocks](./blocks.md). <!-- id:cs2v6x2r -->

The daemon indexes the mention as a link from the document or comment to the [account](./identity.md) or page it names. This link drives "mentions of me" and the mention [trigger](../agent/triggers.md) of a [Seed Agent](../agent.md). The `MentionCandidates` request ranks who or what to suggest while you type.

**How to write one in markdown.** In the markdown that the [CLI](../build/cli.md) and [Seed Agents](../agent.md) read and write, a mention is a Markdown link whose label is `@`:

- `[@](hm://ACCOUNT_UID/:profile)` for a person.
- `[@](hm://UID/path)` for a document.
- Any text after the `@` is ignored. So the `[@Name](…)` form that resolved markdown prints parses back to the same mention.
- The autolink `<hm://ACCOUNT_UID/:profile>` is equivalent.

**What does not count.** These are not mentions. They notify nobody and activate no agent:

- a link whose label does not start with `@`,
- a link to one of the person's comments,
- plain `@Name` text.

**Attributes.** A document attribute set to a person, such as `owner: hm://ACCOUNT_UID`, is a mention. A bare account id or a `:profile` URL works too. The daemon indexes it as a `metadata/Link` citation anchored at the key; see [Metadata](../metadata.md).

# Working with links

On the [Seed API](../build/web-api.md):

- `ListCitations` returns every link record that points at a resource.
- `ListCommentsByReference` returns comments elsewhere that quote or link a document.
- `InteractionSummary` counts comments and citations per document and per block.

[Seed Agents](../agent.md) fire on a `user-mention` [trigger](../agent/triggers.md).

# See also

- [URLs](./urls.md): the grammar of a link, with versions, blocks and ranges.
- [Blocks](./blocks.md): links, embeds and the `Embed` annotation that carries a mention.
- [Comments](./comments.md): block and range comments.
- [Metadata](../metadata.md): attribute values that are links.
- [link](../link.md): the link value type.
