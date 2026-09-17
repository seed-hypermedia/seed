---
name: Blocks
summary: The content of a document or comment is a tree of blocks; this page explains the block tree, block fields, inline annotations, layouts, every built-in block type, embeds, query blocks, tables and text fragments.
---
A Hypermedia document does not store its body as one long string. It stores a tree of small, addressable pieces called blocks: a paragraph, a heading, an image, a table row. Every block has a permanent id, so a link, a comment or a citation can point at exactly one block, and two people editing different blocks never conflict. This page describes the block model as the Seed daemon and the SDK implement it today.

# The block tree

The body of a [document](../document.md) and the body of a [comment](../comment.md) are both an ordered list of [block nodes](../block/node.md). A block node is one [block](../block.md) plus an optional list of child block nodes. Nesting is unlimited; a leaf simply has no children.

The tree is what an editor shows, but it is not what travels on the network. A document is the resolved state of a chain of signed [Changes](../change.md), and each Change carries [operations](../change/op.md) on blocks: [ReplaceBlock](../change/op/replace-block.md) sets a block's whole state, [MoveBlocks](../change/op/move-blocks.md) places a run of blocks under a parent after a sibling, and [DeleteBlocks](../change/op/delete-blocks.md) moves blocks to the trash. The daemon replays those operations with a tree CRDT to produce the tree you read. How the merge works is on [Documents](./documents.md).

Two consequences follow from that design.

- A block that has state but no position is not lost. The daemon returns it in the document's detached blocks, keyed by id. The Seed app uses one detached block, named `navigation`, to hold a site's menu: its children are `Link` blocks, and the [navigation item](../metadata/navigation-item.md) page describes their shape.
- Moving a block never rewrites its contents, and editing a block never changes its position. That is what keeps concurrent edits cheap to merge.

# The block record

A block is a map with five reserved keys, and everything else on the block is an attribute.

| key | type | meaning |
| --- | --- | --- |
| `id` | string | the block's permanent identity inside its document; clients generate an 8-character random id |
| `type` | string | the block type, such as `Paragraph` or `Image`; any string is accepted |
| `text` | string | the block's text, for the types that have text |
| `link` | string | the block's one link: an `hm://`, `ipfs://`, `https://` or `nostr:` URL depending on the type |
| `annotations` | list | inline formatting and inline links over ranges of `text` |
| `revision` | string | output only: the CID of the last Change that modified this block, filled in by the daemon when it serves a document |

Attributes ride at the top level of the block map inside a signed Change. The Seed API and the SDK nest them under an `attributes` key instead, because protobuf cannot carry open fields, which is why an attribute may never be named `id`, `type`, `text`, `link` or `annotations`. The daemon also accepts a legacy encoding forever: some early comments spelled the id key `iD` and put attributes in a nested `attributes` map, and blobs are permanent, so both spellings read back the same.

Two attributes exist on every block that can have children.

- `childrenType` says how the children are laid out. The [children type](../block/children-type.md) values are `Group` (the default, also when the key is absent or null), `Ordered`, `Unordered`, `Blockquote` and `Grid`. A list is therefore a property of the parent, not of the items: the bullet belongs to the block above.
- `columnCount` sets the number of columns of a `Grid`.

# Annotations

Text formatting is not stored as markup inside `text`. Each [annotation](../block/annotation.md) is a layer over the block's text: a `type`, parallel `starts` and `ends` arrays naming one or more ranges, an optional `link`, and inline attributes. Offsets count Unicode code points, not UTF-16 units and not bytes, so a range means the same thing in every language.

| type | carries | meaning |
| --- | --- | --- |
| `Bold`, `Italic`, `Underline`, `Strike`, `Code` | ranges only | text styles |
| `Link` | `link` | a hyperlink to any URL |
| `Embed` | `link`, `mentionKind` | an inline embed or mention; see below |
| `Range` | ranges only | a highlight, rendered as marked text |
| `TextColor`, `BackgroundColor`, `TextSize`, `TextFamily` | `value` | a style value such as a color or a font family |

An inline embed is how a mention works. The block's `text` holds a single placeholder character, U+FEFF, at the position of the mention, and an `Embed` annotation covering that one character carries the `hm://` link. `mentionKind` is `account` for a person (the link is the account or its `/:profile`) or `document` for a page. Readers render the current name of the target in place of the placeholder, so a mention follows a title change. Text fragments and search skip the placeholder characters when they count offsets.

# Built-in block types

The strict set the protocol defines is [core block](../block/core.md): fifteen types. Each type's page lists its attributes; this table gives the one-line meaning and the attributes that matter.

| type | text and link | attributes | notes |
| --- | --- | --- | --- |
| [Paragraph](../block/paragraph.md) | text, annotations | `columnId` when the paragraph is a table cell | the default block |
| [Heading](../block/heading.md) | text, annotations | | a section heading; its children are the section |
| [Code](../block/code.md) | text | `language` | verbatim text, no annotations |
| [Math](../block/math.md) | text | | LaTeX, rendered with KaTeX |
| [Image](../block/image.md) | link (`ipfs://`), text is the caption | `width`, `name` | |
| [Video](../block/video.md) | link | `width`, `name`, `autoplay`, `loop`, `muted` | an `ipfs://` file or a supported web video URL |
| [File](../block/file.md) | link (`ipfs://`) | `name`, `size` | any attachment |
| [Button](../block/button.md) | text is the label, link | `name`, `alignment` (`flex-start`, `center`, `flex-end`) | |
| [Embed](../block/embed.md) | link (`hm://`) | `view` | another document, block or discussion, shown in place |
| [WebEmbed](../block/web-embed.md) | link (`https://`) | | an external page, tweet or post |
| [Nostr](../block/nostr.md) | link (`nostr:`) | | a Nostr event |
| [Table](../block/table.md) | | | the container of a table |
| [TableColumn](../block/table-column.md) | | `width`, `isHeader` | a childless column marker |
| [TableRow](../block/table-row.md) | | `isHeader` | a row; its children are the cells |
| [Query](../block/query.md) | | `query`, `style`, `columnCount`, `banner`, `table` | a live listing of documents |

The Seed app recognizes three more types that are not in the core union. `Slot` is an invisible container with `childrenType` and `columnCount`, used to put a list or a grid at the top level of a document without a visible parent. `Link` is the navigation menu item described above. `Group` is a legacy container some old documents still carry.

An unknown type is never an error. The wire [block](../block.md) schema is open: a document that contains a block type this client has no schema for still parses, keeps the block's fields, and renders it as best it can. That is how a third party adds a block type, and the [poll block example](../example/poll-block.md) shows the schema side of doing so.

# Embeds

An `Embed` block shows another Hypermedia resource inside this one. Its `link` is an `hm://` URL, and the URL decides what is embedded: a whole document, one block with `#blockId`, a block and its children with `#blockId+`, or a text range with `#blockId[start:end]`. The URL also decides which version you see: with `?v=` the embed is pinned to that exact version, with `&l` it follows the latest version. The Seed app pins the version when you embed a block from a comment and follows the latest by default elsewhere. The grammar is on [URLs](./urls.md).

The [embed view](../block/embed-view.md) attribute chooses the rendering: `Content` shows the target's body, `Card` shows its title, summary and cover, `Comments` shows its discussion, and `Link` shows a plain link. Renderers keep a stack of the resources they are inside and stop when an embed would show a document that already contains it, so a cycle renders as a link instead of recursing.

# Query blocks

A `Query` block is a live listing. Instead of copying a list of pages into a document, the author stores a [query](../query.md) and every reader sees the current result. The query has three parts.

- `includes`: one or more [inclusions](../query/inclusion.md), each a space, an optional path prefix inside it, and a mode of `Children` or `AllDescendants`.
- `sort`: a list of [sort terms](../query/sort.md), each `{term, reverse}`. The values the app writes today are `title`, `path`, `created`, `updated`, `displayTime` and `activity`; older documents carry `Title`, `UpdateTime` and the other capitalized spellings, which readers normalize (a legacy time term had newest-first as its default, so its `reverse` flag is flipped on the way in).
- `limit`: an optional maximum number of results.

The block's own attributes choose the presentation: [style](../query/style.md) is `Card`, `List` or `Table`; `columnCount` is the number of card columns; `banner` shows the first result as a banner above the rest; and [table config](../query/table-config.md) remembers which columns are visible and how wide they are in the table view.

The query object carries no filters today. Attribute filters such as "status is Done" live in the Seed API's `QueryDocuments` request and the Explore grammar, described on [the query grammar](../build/query-grammar.md); a query block resolves through the same daemon listing and returns each document's info and metadata, which is why a folder page is usually just a query block over its own children.

# Tables

A table is three block types and no cell type.

- `Table` is the container.
- `TableColumn` blocks come first among its children. They are childless; their only job is identity and order. The sibling order of the columns is the display order, and `width` and `isHeader` are their attributes.
- `TableRow` blocks follow. A row's children are its cells: ordinary `Paragraph` blocks whose `columnId` attribute names a `TableColumn` block id. The order of cells inside a row is ignored; a cell belongs to the column its `columnId` names.

```
Table
├── TableColumn c1
├── TableColumn c2
├── TableRow r1 (isHeader)
│   ├── Paragraph {columnId: c1} "Name"
│   └── Paragraph {columnId: c2} "Age"
└── TableRow r2
    ├── Paragraph {columnId: c1} "Alice"
    └── Paragraph {columnId: c2} "30"
```

A cell's identity is the pair (row block, column id), never a grid position. Editing a cell is a text edit on one paragraph. Adding, reordering or deleting a column is one sibling move or delete of one `TableColumn` block, and no cell renumbers. Two people who concurrently add a row and reorder the columns merge cleanly: the new row lacks a cell for nothing, and the reordered columns still find their cells by id. Readers drop cells whose `columnId` matches no column, render missing cells empty, only honor `isHeader` on the first row and the first column, and drop rows or columns that appear outside a `Table`. The daemon enforces none of this; it treats all three as ordinary blocks, so these are conventions of the clients.

# Text fragments and revisions

Because blocks have ids, a URL can address text inside a document: `#blockId` names a block, `#blockId+` names the block with its children expanded, and `#blockId[start:end]` names a range of the block's text in Unicode code points, counted on the text with inline-embed placeholders removed. Comments, citations and embeds all use these forms; a range comment pins the document version it was made on, because a later edit would move the offsets.

The `revision` the daemon reports on each block is the CID of the last Change that replaced it. A citation of a block records the revision it saw, so a reader can tell whether the cited text has changed since.

# Working with blocks

## In the Seed app

The editor is a block editor built on BlockNote and ProseMirror. Every editor block maps one to one onto a Hypermedia block; the slash menu inserts the built-in types, the drag handle moves blocks and their children together, and a list, quote or grid is a setting on the parent block. Copying a block gives you its `hm://` URL with the block fragment; selecting text and choosing to comment or copy a link gives you a range fragment.

## CLI

`seed-cli document get <id>` prints a document as markdown in which every block ends with a `<!-- id:… -->` comment, block types that markdown cannot express carry `type:` in that comment, and attributes without a native syntax ride as `attrs:` JSON. `document create -f page.md` and `document update` accept the same dialect, match blocks by those ids, and emit only the operations for blocks that changed. `--json` switches to the block tree. The reference is on [the CLI](../build/cli.md).

## SDK

The SDK exports the zod schemas for every block type (`HMBlockSchema` with a passthrough for unknown types), `parseMarkdown` and `blocksToMarkdown` for the lossless markdown dialect, and `createDocumentBlobs` to turn a block tree into signed Changes. The markdown dialect is the same one the CLI prints, and its table form carries column and row identity in comments so a table survives a round trip. See [the SDK](../build/sdk.md).

## Web API

`GET /api/Resource?id=hm://…` returns the document with its `content` tree and `detachedBlocks`. Appending `.md` or `.json` to a site URL exports the same document with embeds, mentions and query blocks resolved. `QueryBlock` resolves a query block server-side. Details are on [the Seed API](../build/web-api.md).

## Agents

Seed Agents and external agents read and write blocks as markdown, never as raw operations. The [read](../agent/read.md) verb returns a document as resolved markdown; the [write](../agent/write.md) verb accepts the dialect above and updates a document in place, and an agent that edits a table must keep the `<!-- col:… -->` and row `<!-- id:… -->` comments so the table's identity survives. Claude Code with the seed-cli skill uses the CLI commands above. [Building with agents](../build/agents.md) has the workflow.

# See also

[Documents](./documents.md), [URLs](./urls.md), [Comments](./comments.md), [Files](./files.md), and the schema pages [block](../block.md), [block/node](../block/node.md), [block/core](../block/core.md), [query](../query.md).
