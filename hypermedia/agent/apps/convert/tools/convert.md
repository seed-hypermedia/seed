---
name: convert
summary: Convert documents from agent memory into markdown with the Datalab parser.
attributesSchema: hm://hyper.media/agent/app-tool
tool: convert
runtime: ts
timeoutSecs: 1800
inputSchema: ./convert.input.json
outputSchema: ./convert.output.json
code: ./convert.ts
---
Converts documents in `~/memory/` with the [Datalab converter](../../convert.md) and writes the markdown and figures back into memory. Read that page for what it writes, the page cap and the keys.

# Calling it

```json
{"files": ["incoming/paper.pdf"]}
```

A folder converts every supported file under it, so a batch of papers is one call:

```json
{"files": ["papers"], "output_dir": "imports/papers"}
```

Other inputs: `page_range` (zero-indexed, `0-5,10`) and `max_pages` convert only part of each document; `mode` picks the Datalab mode (`fast`, `balanced`, `accurate`); `overwrite: true` replaces an output folder from an earlier run. Paths are relative to `~/memory/`; globs are not expanded. One call takes at most 50 documents.

The call runs as long as the conversions take (several documents are converted at once), and the chat shows which file is in progress. The result is small: one line per document with where its markdown is, plus a `failures` list for documents that could not be converted. A failed document never stops the others.

# What it writes

```text
datalab-imports/<slug>/
  raw.md          # the converter output as received
  seed.md         # the same markdown with every figure on its own line, ready to publish
  assets/         # the extracted images
  manifest.json   # pages, quality score, cost, mode, truncation, image mapping
```

`seed.md` is `raw.md` after the tool's post-processing, which does the mechanical part of a good import so the review does not have to:

- Markers Datalab left unpaired are repaired first, because one of them is not local damage: a code fence that never closes swallows the rest of the document, a `$$` block that never closes does the same, and a stray `**` or backtick runs to the end of its paragraph. A fence with no closing fence is dropped, an open `$$` block is closed at the end of its paragraph, and a paragraph, list item, heading or table row with an odd number of `**` or backticks loses the last one. `manifest.json` lists every repair under `markersRepaired` with its line in `raw.md` and the text it touched, and the result counts them.
- Every image reference is a paragraph of its own, `![alt](assets/<file>)`. The markdown parser keeps only standalone image lines as image blocks, and `write ... fromPath` uploads exactly those files, so publishing `seed.md` carries the figures along.
- A `Figure N: …` (or `Fig.`, `Table`) paragraph next to a figure becomes the figure's caption, the alt text of the image line, and the loose paragraph is gone. A figure has exactly one caption, in the image itself.
- Entries of the references section get block ids (`<!-- id:ref-3 -->`, `<!-- id:ref-meyrowitz-1986 -->`), and bracketed citations in the text become links to them: numeric ones, `[3]`, `[1, 2]`, `[4-6]`, and labelled ones, `[Meyrowitz 1986]`, `[Langston 1988, Ogura & Robertson 1989]`, written as `[[3](#ref-3)]`. Publishing resolves those `#ref-…` links to the document's own address, so readers jump from a citation to its entry. Citations with no matching entry, and parenthesised ones like `(Meyrowitz, 1986)`, are left as text and the former are counted in the result (`citationsUnlinked`); link those by hand only when the entry is unambiguous.
- Links the PDF itself carried (`extract_links` keeps them as `[\[49\].](#block-9-2)` with `<a id>` anchors) are reduced to their text, because the anchors do not survive publishing; the citations among them get the precise `#ref-…` links above instead. One-line display math `$$…$$` becomes a fenced `$$` block, which is the only form the markdown dialect reads.

# Before publishing

Review `seed.md`: headings, tables, where figures landed, every line `manifest.json` lists under `markersRepaired` (a repair is a guess about what the marker meant, so read the sentence), and the citations the result lists as unlinked: link each one whose entry exists by hand, `[[Olivetti undated](#ref-olivetti-undated)]`, giving the entry its `<!-- id:ref-… -->` comment when it has none, so no citation is left as plain text. Do not render pages, re-extract figures or verify metadata on the web: the figures are already in `assets/`, and the metadata comes from the document itself. Then put the document's metadata from the [Agent Guide](../../../guide.md) as YAML frontmatter at the top of `seed.md` and publish with `write hm://<account>/<path> {fromPath: "~/memory/datalab-imports/<slug>/seed.md"}`. `fromPath` reads `name`, `summary`, `displayAuthor` and `displayPublishTime` from that frontmatter and accepts no `name` or `metadata` options of its own. Charts come back as data tables with a description; links in the source are kept.

```markdown
---
name: Credit Suisse EUR 1.25bn 0.250% Senior Notes due 2028
summary: Final terms dated 27 August 2021 for the EUR 1,250,000,000 0.250% fixed-rate senior notes.
displayAuthor: Credit Suisse AG
displayPublishTime: 2021-08-27
---

## FINAL TERMS
```
