---
name: Markdown dialect
summary: The lossless markdown form of a Hypermedia document, what each part of the syntax carries, and the SDK functions that read and write it.
---
A Hypermedia [document](../protocol/documents.md) is a tree of typed [blocks](../protocol/blocks.md) with [annotations](../protocol/blocks.md) and [metadata](../metadata.md). The markdown dialect is a text form that carries all of it. A document written to markdown and parsed again is the same document. The [Seed CLI](./cli.md) prints and accepts it, [folder sync](./publish-a-folder.md) stores a space in it, and a site's `.md` export and the agents' [`read`](../agent/read.md) verb return a display form of it. It is implemented once, in the [SDK](./sdk.md).

# The format

- **Ordinary markdown where it exists.** Headings, paragraphs, lists, block quotes, fenced code, math, images, links, tables, bold, italic, strikethrough and inline code are plain markdown.
- **Frontmatter.** A YAML block at the top holds every metadata key of the document, including keys the client does not know.
- **Block identity.** Each block ends with an HTML comment, `<!-- id:X -->`. The id is what makes an edit an update of that block and not a replacement.
- **What markdown cannot say.** The same comment may carry `type:`, naming a block type such as Video, File, Button, Embed or Query, and `attrs:`, a JSON object of attributes such as an image width or a query definition.
- **Nesting.** A block's children sit two spaces deeper, or at the content column of a list marker. A heading's children follow it at the same indentation, and `<!-- end:X -->` closes a heading when a non-heading sibling follows.
- **Text.** Markdown syntax characters in text are escaped. A newline inside a block is `<br>`. Styles markdown lacks, such as underline, highlight and colors, are inline HTML tags.
- **Diagrams.** A `mermaid` code fence is a diagram and must parse.
- **Files without ids.** A hand-written file needs no comments. Its blocks are matched to an existing document by position.

# Functions <!-- id:ZwTWCrBr -->

`blocksToMarkdown(doc)` and `parseMarkdown(md)` are a lossless pair: every [block](../protocol/blocks.md) type, [annotation](../protocol/blocks.md), attribute and [metadata](../metadata.md) key survives a round trip. The frontmatter is YAML with every metadata key. Each block ends in an `<!-- id:X -->` comment, with `type:` and `attrs:` in the same comment for what markdown cannot express. Nesting is indentation. `parseMarkdown` returns `{tree, metadata}` and `flattenToOperations` turns the tree into `DocumentOperation`s. `markdownBlockNodesToHMBlockNodes` converts the parsed tree to the API shape. `parseMarkdown` throws `MarkdownFrontmatterError` on frontmatter whose YAML does not parse (pass `{strictFrontmatter: false}` on a display path that must render anything). `assertValidMermaid(nodes, parser)` rejects with `InvalidMermaidError` when a mermaid Code block does not parse; `loadMermaidParser()` from `@seed-hypermedia/client/mermaid-parser` supplies the parser in a browser, Node or Bun (with `mermaid`, plus `linkedom` outside a browser, installed by the caller). [Publish a folder](./publish-a-folder.md) describes the dialect as a writer sees it. <!-- id:WvgA5VpZ -->

For display, `documentToResolvedMarkdown(doc, {client, maxDepth?})`, `commentToResolvedMarkdown` and `contentToResolvedMarkdown` fetch embeds, [mentions](../protocol/links-and-citations.md) and [query blocks](../protocol/blocks.md) over the network and inline them. The web `.md` export and the agents' [`read`](../agent/read.md) verb return this form. <!-- id:60n-DBmo -->

Drafts: `slugify(title)`, `draftFilename(slug, id)` (`<slug>_<id>.md`) and `parseDraftFilename` name draft files the way the CLI and the desktop app do. <!-- id:wxZ_H1P7 -->

# See also

- [SDK](./sdk.md)
- [Publish a folder](./publish-a-folder.md), which keeps a directory of these files and a space in step
- [Seed CLI](./cli.md), `document get`, `document update` and the `space` commands
- [Blocks](../protocol/blocks.md)
- [Metadata](../metadata.md)
