---
name: Markdown dialect
summary: The markdown dialect is the markdown form of a Hypermedia document that loses nothing; this page lists what each part of the syntax carries and the SDK functions that read and write it.
---
The markdown dialect is a way to write a Hypermedia [document](../protocol/documents.md) as a markdown file without losing anything. A document is a tree of typed [blocks](../protocol/blocks.md) with [annotations](../protocol/blocks.md) and [metadata](../metadata.md). Plain markdown can say most of that, and the dialect adds the rest. If you write a document to markdown and parse it again, you get the same document.

Several programs use it:

- The [Seed CLI](./cli.md) prints it and accepts it.
- [Folder sync](./publish-a-folder.md) stores a whole [space](../protocol/spaces.md) in it.
- A [site](../protocol/sites.md)'s `.md` export and the [`read`](../agent/read.md) tool of [Seed Agents](../agent.md) return it with what the blocks point at shown beside them.

The code exists once, in the [SDK](./sdk.md).

# The format

- **Ordinary markdown where it exists.** Headings, paragraphs, lists, block quotes, fenced code, math, images, links, tables, bold, italic, strikethrough and inline code are plain markdown.
- **Frontmatter.** A YAML block at the top holds every metadata key of the document. It keeps keys the program does not know.
- **Block identity.** Each block ends with an HTML marker, `<!-- id:X -->`. The id tells a program that an edit changes that block and does not replace it.
- **What markdown cannot say.** The same marker may carry `type:`, naming a block type such as Video, File, Button, Embed or Query, and `attrs:`, a JSON object of attributes such as an image width or a query definition.
- **Nesting.** A block's children sit two spaces deeper, or at the content column of a list marker. A heading's children follow it at the same indentation, and `<!-- end:X -->` closes a heading when a non-heading sibling follows.
- **Text.** Markdown syntax characters in text are escaped. A newline inside a block is `<br>`. Styles markdown lacks, such as underline, highlight and colors, are inline HTML tags.
- **Diagrams.** A `mermaid` code fence is a diagram and must parse.
- **Shown for the reader.** Lines between `<!-- resolved: … -->` and `<!-- /resolved -->` show what the block above them points at: the content of an embed, or the results of a query. They are not part of the document, and the parser skips them.
- **Files without ids.** A file you write by hand needs no markers. Its blocks are matched to an existing document by position.

# Functions <!-- id:ZwTWCrBr -->

**Write and parse.** `blocksToMarkdown(doc)` and `parseMarkdown(md)` are a pair that loses nothing. Every [block](../protocol/blocks.md) type, [annotation](../protocol/blocks.md), attribute and [metadata](../metadata.md) key comes back the same after a round trip. <!-- id:WvgA5VpZ -->

- `parseMarkdown` returns `{tree, metadata}`.
- `flattenToOperations` turns the tree into `DocumentOperation`s, the steps you publish.
- `markdownBlockNodesToHMBlockNodes` converts the parsed tree to the shape the API uses.

**Errors.**

- `parseMarkdown` throws `MarkdownFrontmatterError` when the YAML in the frontmatter does not parse. Pass `{strictFrontmatter: false}` where the code only shows the text and must accept anything.
- `parseMarkdown` throws `MarkdownResolvedRangeError` when a `resolved` range is never closed. Pass `{strictResolvedRanges: false}` to drop what follows it.
- `assertValidMermaid(nodes, parser)` rejects with `InvalidMermaidError` when a mermaid Code block does not parse.
- `loadMermaidParser()` from `@seed-hypermedia/client/mermaid-parser` gives you the parser in a browser, Node or Bun. You install `mermaid` yourself, and also `linkedom` when you are not in a browser.

[Publish a folder](./publish-a-folder.md) describes the dialect from a writer's side.

**For reading.** `documentToResolvedMarkdown(doc, {client, maxDepth?, ipfsGateway?})`, `commentToResolvedMarkdown` and `contentToResolvedMarkdown` fetch embeds, [mentions](../protocol/links-and-citations.md) and [query blocks](../block/query.md) over the network. Every block is written as `blocksToMarkdown` writes it. A mention gets the name of its target (`[@Name](hm://…)`), and an embed or a query is followed by a `resolved` range holding what it shows. So this form parses back to the same document too. `commentToResolvedMarkdown` does this for a [comment](../protocol/comments.md). The web `.md` export and the `read` tool of Seed Agents return this form. <!-- id:60n-DBmo -->

**Updating from markdown.** `markdownUpdateTree(storedContent, parsedTree)` prepares a parsed body for `computeReplaceOps`. A block that reads the same as the stored block is kept as stored, and a block that lost its id marker gets the id back when its text matches a stored block. `applyBlockEdits(tree, edits, parse)` changes blocks by id (`replace`, `after`, `before`, `into`, `move`, `delete`) and leaves the others alone. `describeContentChange` counts the blocks an update adds, rewrites, moves and deletes.

**Drafts.** `slugify(title)`, `draftFilename(slug, id)` (`<slug>_<id>.md`) and `parseDraftFilename` name draft files the way the CLI and the [desktop app](../software/desktop.md) do. <!-- id:wxZ_H1P7 -->

# See also

- [SDK](./sdk.md)
- [Publish a folder](./publish-a-folder.md), which keeps a folder of these files and a space the same
- [Seed CLI](./cli.md), `document get`, `document update` and the `space` commands
- [Blocks](../protocol/blocks.md)
- [Metadata](../metadata.md)
