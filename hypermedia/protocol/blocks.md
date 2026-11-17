---
name: Blocks
summary: The content of a document or a comment is a tree of blocks, and this page explains the tree, the fields of a block, annotations, every built-in block type, embeds, query blocks, tables and text fragments.
---
A Hypermedia [document](./documents.md) stores its body as a tree of small pieces called blocks. A block is one paragraph, one heading, one image or one table row. Every block has an id that never changes. So a link, a [comment](./comments.md) or a citation can point at exactly one block. Two people who edit different blocks never conflict. <!-- id:W37Ua9TA -->

This page describes the block model as the Seed [daemon](../software/daemon.md) and the [SDK](../build/sdk.md) implement it.

# The block tree <!-- id:0PGaEtrf -->

The body of a [document](../document.md) and the body of a [comment](../comment.md) are both an ordered list of [block nodes](../block/node.md). A block node is one [block](../block.md) plus an optional list of child block nodes. Nesting has no limit. A leaf has no children. <!-- id:Hssa6ykh -->

An editor shows the tree, but the tree does not travel on the network. A document is the result of replaying a chain of signed [Changes](../change.md), and each Change carries [operations](../change/op.md) on blocks: <!-- id:6ZanumjT -->

- [ReplaceBlock](../change/op/replace-block.md) sets a block's whole state.
- [MoveBlocks](../change/op/move-blocks.md) places a run of blocks under a parent, after a sibling.
- [DeleteBlocks](../change/op/delete-blocks.md) moves blocks to the trash.

The daemon replays those operations to produce the tree you read. [Documents](./documents.md) explains how it merges them.

Two things follow from this. <!-- id:sXdaIUr5 -->
  - A block that has state but no position is not lost. It is called a detached block. The daemon returns it in the document's detached blocks, keyed by id. The [Seed app](../software/desktop.md) uses one detached block, named `navigation`, to hold a [site](./sites.md)'s menu. Its children are `Link` blocks, and the [navigation item](../metadata/navigation-item.md) page describes their shape. <!-- id:CaBHtFLs -->
  - Moving a block never rewrites its contents, and editing a block never changes its position. This keeps concurrent edits cheap to merge. <!-- id:oHpa20i- -->

# The block record <!-- id:vRfSMQd7 -->

A block is a map with five reserved keys. Everything else on the block is an attribute. The daemon adds a sixth key, `revision`, when it serves a document. <!-- id:KIE_IMxO -->

<!-- id:HWV-VUit -->
| key <!-- col:b6lej1mO --> | type <!-- col:N70latFe --> | meaning <!-- col:vcBsyTBO --> <!-- id:VFvG0bmr --> |
| --- | --- | --- |
| `id` | string | the block's permanent identity inside its document; clients generate an 8-character random id <!-- id:bWhpIDMr --> |
| `type` | string | the block type, such as `Paragraph` or `Image`; any string is accepted <!-- id:TbT-3CN_ --> |
| `text` | string | the block's text, for the types that have text <!-- id:2VjyLmcn --> |
| `link` | string | the block's one link: an `hm://`, `ipfs://`, `https://` or `nostr:` URL depending on the type <!-- id:EpotEt0g --> |
| `annotations` | list | inline formatting and inline links over ranges of `text` <!-- id:R4BQrLPX --> |
| `revision` | string | output only: the [CID](../cid.md) of the last Change that modified this block, filled in by the daemon when it serves a document <!-- id:6_LL2Qaq --> |

Attributes sit in two different places: <!-- id:qE-4Fy-g -->

- Inside a signed Change, attributes sit at the top level of the block map.
- The [Seed API](../build/web-api.md) and the SDK nest them under an `attributes` key, because protobuf cannot carry open fields.

So an attribute may never be named `id`, `type`, `text`, `link` or `annotations`. The daemon also accepts an older encoding forever. Some early comments spelled the id key `iD` and put attributes in a nested `attributes` map. [Blobs](./blobs.md) are permanent, so both spellings read back the same.

Three attributes are common to many blocks. The first two lay out a block's children. The third aligns the block's own text. <!-- id:1GIO2fft -->
  - `childrenType` sets how the children are laid out. The [children type](../block/children-type.md) values are `Group` (the default, also when the key is absent or null), `Ordered`, `Unordered`, `Blockquote` and `Grid`. So a list is a property of the parent block. The bullet belongs to the block above the items. <!-- id:3lFuYqIR -->
  - `columnCount` sets the number of columns of a `Grid`. <!-- id:FzlPjJlS -->
  - `textAlignment` aligns the block's own text: `left`, `center`, `right` or `justify`, see [text alignment](../block/text-alignment.md). The key is left out for the default `left`. <!-- id:foRiuGpp -->

# Annotations <!-- id:J0Hq4KQP -->

`text` holds no markup. Formatting lives in annotations. Each [annotation](../block/annotation.md) is a layer over the block's text. It has a `type`, two matching arrays `starts` and `ends` that name one or more ranges, an optional `link`, and inline attributes. Offsets count Unicode code points. They do not count UTF-16 units or bytes, so a range means the same thing in every language. <!-- id:qDSYmMrx -->

<!-- id:IzNLaMAp -->
| type <!-- col:kDNk3Gl0 --> | carries <!-- col:YeM4ZmZx --> | meaning <!-- col:YPenYqjb --> <!-- id:BcH62YUb --> |
| --- | --- | --- |
| `Bold`, `Italic`, `Underline`, `Strike`, `Code` | ranges only | text styles <!-- id:ZWJWeT7A --> |
| `Link` | `link` | a hyperlink to any URL <!-- id:f-eQfVAQ --> |
| `Embed` | `link`, `mentionKind` | an inline embed or mention; see below <!-- id:hlHHuweh --> |
| `Range` | ranges only | a highlight, rendered as marked text <!-- id:8yCEreSK --> |
| `TextColor`, `BackgroundColor`, `TextSize`, `TextFamily` | `value` | a style value such as a color or a font family <!-- id:813uEvcy --> |

A mention is an inline embed. It works like this: <!-- id:Db5LYiXW -->

- The block's `text` holds a single placeholder character, U+FFFC (the object replacement character), at the position of the mention.
- An `Embed` annotation that covers that one character carries the [`hm://` link](./urls.md).
- `mentionKind` is `account` for a person (the link is the [account](./identity.md) or its `/:profile`) or `document` for a page.

Readers show the target's name in place of the placeholder, so a mention follows a title change. Text fragments and search skip the placeholder characters when they count offsets. [Links and citations](./links-and-citations.md) covers what a mention does and how to write one in markdown.

# Built-in block types <!-- id:Ab6ehaxJ -->

The protocol defines a strict set of fifteen types, the [core block](../block/core.md). Each type's page lists its attributes. This table gives the one-line meaning and the attributes that matter. <!-- id:8GRodUyF -->

<!-- id:eZlf41b- -->
| type <!-- col:OGqTvrus --> | text and link <!-- col:r8PD_YLp --> | attributes <!-- col:gnsi2kcF --> | notes <!-- col:BKSgGRJk --> <!-- id:93vnudHr --> |
| --- | --- | --- | --- |
| [Paragraph](../block/paragraph.md) | text, annotations | `columnId` when the paragraph is a table cell | the default block <!-- id:CxsZZagJ --> |
| [Heading](../block/heading.md) | text, annotations |  | a section heading; its children are the section <!-- id:GPCepHQV --> |
| [Code](../block/code.md) | text | `language` | verbatim text, no annotations <!-- id:B_tw-5yf --> |
| [Math](../block/math.md) | text |  | LaTeX, rendered with KaTeX <!-- id:cZFahjQ1 --> |
| [Image](../block/image.md) | link (`ipfs://`), text is the caption | `width`, `name` | <!-- id:6EKOHush --> |
| [Video](../block/video.md) | link | `width`, `name`, `autoplay`, `loop`, `muted` | an `ipfs://` file or a supported web video URL <!-- id:Ix7PVp-r --> |
| [File](../block/file.md) | link (`ipfs://`) | `name`, `size` | any attachment <!-- id:eC1ljFnC --> |
| [Button](../block/button.md) | text is the label, link | `name`, `alignment` (`flex-start`, `center`, `flex-end`) | <!-- id:2AaTnHtV --> |
| [Embed](../block/embed.md) | link (`hm://`) | `view` | another document, block or discussion, shown in place <!-- id:x1mftSFm --> |
| [WebEmbed](../block/web-embed.md) | link (`https://`) |  | an external page, tweet or post <!-- id:6PakYdG_ --> |
| [Nostr](../block/nostr.md) | link (`nostr:`) |  | a Nostr event <!-- id:gJ48aXhU --> |
| [Table](../block/table.md) |  |  | the container of a table <!-- id:_rGZQo9Z --> |
| [TableColumn](../block/table-column.md) |  | `width`, `isHeader` | a childless column marker <!-- id:pMXL4HzO --> |
| [TableRow](../block/table-row.md) |  | `isHeader` | a row; its children are the cells <!-- id:MgMxKLtx --> |
| [Query](../block/query.md) |  | `query`, `style`, `columnCount`, `banner`, `table` | a live listing of documents <!-- id:H1OGhNUY --> |

An `ipfs://` link points at a [file](./files.md) stored as IPFS data. The Seed app knows three more types that are not in the core set: <!-- id:q4mjd82L -->

- `Slot` is an invisible container with `childrenType` and `columnCount`. It puts a list or a grid at the top level of a document without a visible parent.
- `Link` is the navigation menu item described above.
- `Group` is an older container that some old documents still carry.

An unknown type is never an error. The wire [block](../block.md) schema is open. Suppose a document contains a block type that a client has no schema for. The client still parses the document, keeps the block's fields, and renders the block as well as it can. This is how a third party adds a block type. The [poll block example](../example/poll-block.md) shows the schema side. <!-- id:HK5YNiap -->

# Embeds <!-- id:U4JGYCtf -->

An `Embed` block shows another Hypermedia [resource](../glossary.md) inside this one. Its `link` is an `hm://` URL, and the URL decides what is embedded: <!-- id:HmN49Lid -->

- a whole document,
- one block, with `#blockId`,
- a block and its children, with `#blockId+`,
- a text range, with `#blockId[start:end]`.

The URL also decides which [version](./documents.md) you see. With `?v=` the embed is pinned to that exact version. With the `l` flag, or with no version, it follows the latest version. The Seed app pins the version when you embed a block from a [comment](./comments.md), and follows the latest by default everywhere else. [URLs](./urls.md) has the grammar.

The [embed view](../block/embed-view.md) attribute chooses how the embed looks. `Content` shows the target's body. `Card` shows its title, summary and cover. `Comments` shows its discussion. `Link` shows a plain link. Renderers keep a stack of the resources they are inside. They stop when an embed would show a document that already contains it. So a cycle renders as a link and does not repeat forever. <!-- id:v-l5BrCw -->

# Query blocks <!-- id:2CLfvJsM -->

A `Query` block is a live listing. The author stores a [query](../query.md), and every reader sees the result as it is when they read. The query has three parts. <!-- id:d0v7wprf -->
  - `includes`: one or more [inclusions](../query/inclusion.md), each a [space](./spaces.md), an optional path prefix inside it, and a mode of `Children` or `AllDescendants`. <!-- id:mYJkUEW7 -->
  - `sort`: a list of [sort terms](../query/sort.md), each `{term, reverse}`. The app writes `title`, `path`, `created`, `updated`, `displayTime` and `activity`. Some documents carry `Title`, `UpdateTime` and the other capitalized spellings, and readers normalize them. A capitalized time term sorts newest first by default, so readers flip its `reverse` flag when they read it. <!-- id:dC_nJi_7 -->
  - `limit`: an optional maximum number of results. <!-- id:oZxBg7kh -->

The block's own attributes choose the presentation. [style](../query/style.md) is `Card`, `List` or `Table`. `columnCount` is the number of card columns. `banner` shows the first result as a banner above the rest. [table config](../query/table-config.md) remembers which columns are visible in the table view and how wide they are. <!-- id:cxzenQBe -->

The query object carries no filters. Attribute filters such as "status is Done" live in the [Seed API](../build/web-api.md)'s `QueryDocuments` request and the Explore grammar, described in [the query grammar](../build/query-grammar.md). A query block resolves through the same daemon listing and returns each document's info and [metadata](../metadata.md). That is why a folder page is usually one query block over its own children. <!-- id:ndrQtVsj -->

## Collections <!-- id:HWyyW7c4 -->

A **collection** is a document whose content is exactly one top-level `Query` block that lists the document's own children. The protocol has no collection concept, and no attribute declares one. The shape alone decides. The TypeScript document machine and the Go indexer implement the same rule. A document is a collection when all three hold: <!-- id:RXWlzrq5 -->
  - it has exactly one top-level block; <!-- id:uLThgBpv -->
  - that block is a `Query` block; <!-- id:1mikg4Rd -->
  - the query has no `includes`, an empty list, or exactly one inclusion that is either empty (no space and no path) or names the document's own space and normalized path. <!-- id:60tZZwqq -->

The style (`Card`, `List` or `Table`), the table config and any blocks nested under the query block do not matter. Any of these makes it an ordinary document: more than one top-level block, more than one inclusion, a partly filled inclusion, or an inclusion that points elsewhere. A `type: Collection` metadata attribute is ignored. <!-- id:I0_0PZTQ -->

The daemon works out the flag when it indexes a published document. It serves the flag as `DocumentInfo.is_collection` (`isCollection` in the [SDK](../build/sdk.md)), so listings can show a collection icon without fetching the body. The value is optional. Unset means the indexer has not reached that document, and readers treat it as an ordinary document. Working out the flag never blocks indexing. <!-- id:GDbOHYOJ -->

In the Seed app, **New Collection** starts a draft with one canonical query block (`Table`, an empty `Children` inclusion, sorted by `updated`). Publishing points that inclusion at the final space and path. <!-- id:5qaOlDBP -->

# Tables <!-- id:0pXxkUBN -->

A table uses three block types. There is no cell type. <!-- id:KXR-1HKt -->
  - `Table` is the container. <!-- id:I7Udwv0K -->
  - `TableColumn` blocks come first among its children. They have no children and carry only identity and order. The sibling order of the columns is the display order. `width` and `isHeader` are their attributes. <!-- id:HRd4VRbr -->
  - `TableRow` blocks follow. A row's children are its cells: ordinary `Paragraph` blocks whose `columnId` attribute names a `TableColumn` block id. The order of cells inside a row is ignored. A cell belongs to the column its `columnId` names. <!-- id:jxanu9_H -->

``` <!-- id:GzxwakGG -->
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

A cell's identity is the pair (row block, column id). It is never a grid position. This has good effects: <!-- id:dcl_GwXb -->

- Editing a cell is a text edit on one paragraph.
- Adding, reordering or deleting a column is one sibling move or delete of one `TableColumn` block, and no cell is renumbered.
- Two people who add a row and reorder the columns at the same time merge cleanly. The new row has a cell for every column, and the reordered columns still find their cells by id.

Readers follow these rules:

- They drop cells whose `columnId` matches no column.
- They render missing cells empty.
- They honor `isHeader` only on the first row and the first column.
- They drop rows or columns that appear outside a `Table`.

The daemon enforces none of this. It treats all three types as ordinary blocks, so these rules are client conventions.

# Text fragments and revisions <!-- id:EGCeQiUO -->

Because blocks have ids, a [URL](./urls.md) can address text inside a document. <!-- id:UFkDmnpu -->

- `#blockId` names a block.
- `#blockId+` names the block with its children expanded.
- `#blockId[start:end]` names a range of the block's text in Unicode code points, counted on the text with inline-embed placeholders removed.

[Comments](./comments.md), citations and embeds all use these forms. A range comment pins the document [version](./documents.md) it was made on, because a later edit would move the offsets.

The `revision` the daemon reports on each block is the CID of the last Change that replaced it. A citation of a block records the revision it saw, so a reader can tell whether the cited text has changed since. <!-- id:egTNNVxS -->

# Working with blocks <!-- id:6YL3RLsp -->

- **CLI.** `seed-cli document get <id>` prints a document as markdown. Every block ends with a `<!-- id:… -->` comment. Block types that markdown cannot express carry `type:` in that comment, and attributes without a native syntax are written as `attrs:` JSON. `document create -f page.md` and `document update` accept the same dialect. They match blocks by those ids and emit operations only for blocks that changed. `--json` switches to the block tree. See [Seed CLI](../build/cli.md). <!-- id:pznE_tFb -->
- **SDK.** The SDK exports the zod schemas for every block type (`HMBlockSchema` with a passthrough for unknown types). It exports `parseMarkdown` and `blocksToMarkdown` for the lossless [markdown dialect](../build/markdown-dialect.md), and `createDocumentBlobs` to turn a block tree into signed Changes. The markdown dialect is the one the CLI prints. Its table form carries column and row identity in comments, so a table survives a round trip. See [SDK](../build/sdk.md). <!-- id:Q13Icb5C -->
- **Seed API.** `GET /api/Resource?id=hm://…` returns the document with its `content` tree and `detachedBlocks`. Add `.md` or `.json` to a site URL to export the same document with embeds, mentions and query blocks resolved. `QueryBlock` resolves a query block on the server. See [Seed API](../build/web-api.md). <!-- id:3pF1uWI3 -->
- **Agents.** [Seed Agents](../agent.md) and external agents read and write blocks as markdown. They do not send raw operations. The [read](../agent/read.md) verb returns a document as resolved markdown. The [write](../agent/write.md) verb accepts the dialect above and updates a document in place. An agent that edits a table must keep the `<!-- col:… -->` and row `<!-- id:… -->` comments, so the table's identity survives. Claude Code with the seed-cli skill uses the CLI commands above. [Using Seed from your own agent](../build/agents.md) has the workflow. <!-- id:iY-h20Xf -->

# See also <!-- id:BMxeMIXC -->

- [Documents](./documents.md): how Changes merge into the block tree. <!-- id:docIFdLk -->
- [URLs](./urls.md): block and range fragments. <!-- id:NwAK7W4l -->
- [Links and citations](./links-and-citations.md): how links and mentions are indexed.
- [Comments](./comments.md): comments that attach to blocks. <!-- id:nuXFRtzK -->
- [Files](./files.md): what image and file blocks link to. <!-- id:dBPmEMtT -->
- [Hypermedia Schemas](../schema.md): typed attributes and custom block types. <!-- id:EvM2XdLy -->
- Schema pages: [block](../block.md), [block/node](../block/node.md), [block/core](../block/core.md), [block/annotation](../block/annotation.md), [query](../query.md). <!-- id:FsoO2LJ0 -->
