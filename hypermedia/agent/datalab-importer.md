---
name: Document import with convert
summary: The convert tool turns PDFs, office documents, EPUBs and images from agent memory into reviewable markdown with the Datalab document parser, on the server, without the agent ever holding an API key.
---
`convert` is a built-in callable. It sends a document from `~/memory/` to the Datalab document parser and writes the markdown and the extracted figures back into memory, next to the source. The agent reviews the markdown, adds metadata, and publishes it with `write ... fromPath`, like any other memory file. The agent never talks to Datalab and never sees a key.

# Supported documents

PDF (`.pdf`); Word (`.doc`, `.docx`, `.odt`); spreadsheets (`.xls`, `.xlsx`, `.xlsm`, `.xltx`, `.csv`, `.ods`); presentations (`.ppt`, `.pptx`, `.odp`); web and ebooks (`.html`, `.epub`); images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tiff`). Each file may be up to 100 MiB. An image counts as one page. Markdown and plain text are not documents to convert: read them directly.

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

`seed.md` is `raw.md` after the server's post-processing, which does the mechanical part of a good import so the review does not have to:

- Every image reference is a paragraph of its own, `![alt](assets/<file>)`. The markdown parser keeps only standalone image lines as image blocks, and `write ... fromPath` uploads exactly those files, so publishing `seed.md` carries the figures along.
- A `Figure N: …` (or `Fig.`, `Table`) paragraph next to a figure becomes the figure's caption, the alt text of the image line, and the loose paragraph is gone. A figure has exactly one caption, in the image itself.
- Entries of the references section get block ids (`<!-- id:ref-3 -->`, `<!-- id:ref-meyrowitz-1986 -->`), and bracketed citations in the text become links to them: numeric ones, `[3]`, `[1, 2]`, `[4-6]`, and labelled ones, `[Meyrowitz 1986]`, `[Langston 1988, Ogura & Robertson 1989]`, written as `[[3](#ref-3)]`. Publishing resolves those `#ref-…` links to the document's own address, so readers jump from a citation to its entry. Citations with no matching entry, and parenthesised ones like `(Meyrowitz, 1986)`, are left as text and the former are counted in the result (`citationsUnlinked`); link those by hand only when the entry is unambiguous.

Review `seed.md` before publishing: headings, tables, where figures landed, and the citations the result says it could not link. Do not render pages, re-extract figures or verify metadata on the web: the figures are already in `assets/`, and the metadata comes from the document itself. Then put the document's metadata from the [Agent Guide](./guide.md) as YAML frontmatter at the top of `seed.md` and publish with `write hm://<account>/<path> {fromPath: "~/memory/datalab-imports/<slug>/seed.md"}`. `fromPath` reads `name`, `summary`, `displayAuthor` and `displayPublishTime` from that frontmatter and accepts no `name` or `metadata` options of its own. Charts come back as data tables with a description; links in the source are kept.

```markdown
---
name: Credit Suisse EUR 1.25bn 0.250% Senior Notes due 2028
summary: Final terms dated 27 August 2021 for the EUR 1,250,000,000 0.250% fixed-rate senior notes.
displayAuthor: Credit Suisse AG
displayPublishTime: 2021-08-27
---

## FINAL TERMS
```

# Pages, cost and the page cap

Datalab bills per page. Every conversion has a page cap: the smaller of `max_pages`, the per-call cap (200 pages), and what the account and the server still have this month on the shared key. The cap is what Datalab is told, so a call can never cost more than was set aside for it. A document longer than its cap is converted up to the cap and reported with `truncated: true`; `manifest.json` names the limit that cut it. Convert long documents in parts with `page_range`.

# Keys

The server picks the key, in this order:

1. The account's own Datalab key, saved as the secret `datalab-api-key` (`SetSecret`, metadata `{kind: "datalab-api-key"}`). Pages on it are not counted against anything, and any `mode` goes through.
2. The server's shared key, metered per account per UTC month with a server-wide ceiling. A `mode` more expensive than the server's is lowered to it, and the result says so.
3. A relay: a server without a key (the one inside the desktop app, a self-hosted one) sends the document to the hosted server as a signed `ConvertDocument` action and polls `GetConversion`. The request is signed with the agent's own identity key, so the hosted server bills that identity's account. An agent without a signing identity cannot relay and gets told so.

When none of these applies the tool is not offered at all, so the model never sees a tool that can only fail. An exhausted allowance answers with how much was used and how to add an own key.

# See also

- [Agent Guide](./guide.md)
- [Tools](./tools.md)
- [Signed API](./signed-api.md) for `ConvertDocument` and `GetConversion`
- [Operations](./operations.md) for the server settings
