This tool turns one document into Markdown for a Seed document. It sends the file to the Datalab conversion service and
cleans what comes back. It takes PDF, Word, PowerPoint and Excel files, their OpenDocument forms, CSV, HTML, EPUB, and
PNG, JPEG, WebP, GIF and TIFF images.

**The tool does the conversion. The import is your job.** What the tool returns is a first draft. It has not been
compared with the source, its figures may be broken, most of its citations may be unlinked, and nothing is published.
Everything under [After the call](#after-the-call) is required every time. An import that skips those steps is not
finished, however good the Markdown looks.

# Before the call

1. **Know where the document goes.** Get the exact destination from the person who asked: an `hm://ACCOUNT/path`
   address. Never choose one yourself. The document above it must already exist.
2. **Ask what else is wanted.** Ask whether the requester wants structured fields from the document, such as its title,
   authors and year. Extract them only when they name the fields or give a schema.
3. **Leave the key alone.** The tool reads one secret, `datalabApiKey`, from the app or agent that hosts it. Never ask
   for the key in a conversation. Never put it in the input, in memory or in a document.
4. **Know what a call costs.** Every call is billed to the host's key, by the page. Use `pageRange` to convert only the
   pages you need, and `maxPages` to cap the bill. The host sets the ceilings for `mode` and `maxPages`. A call can
   lower them, never raise them.
5. **Know what a call reveals.** The server records every call, and anyone can read the record. It holds the file's
   name, type and size, the page count and the cost. It never holds the file's text or figures. If the file's name is
   itself private, rename the copy you send.
6. **Keep the source.** Send one file per call, 45 MiB at most. The name's extension says what the file is. Keep the
   original unchanged and within reach: every step after the call compares against it.

Markdown and plain text need no conversion. Read those directly.

# The call

| Field       | What it is                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `file`      | The document: `{name, mimeType, data}`, with the bytes as base64. Needed to start a conversion.     |
| `job`       | The value a call that answered `pending` returned. Send it with no file to collect that conversion. |
| `pageRange` | Pages to convert, counted from zero, such as `0-5,10`. All pages when left out.                     |
| `maxPages`  | The most pages to convert.                                                                          |
| `mode`      | `fast`, `balanced` or `accurate`.                                                                   |

An agent names the file and the server puts the bytes in. Use `saveTo`, so the Markdown and its images land in one
folder:

```json
{
  "tool": "hm://SPACE/datalab",
  "input": {"file": {"fromPath": "~/memory/incoming/paper.pdf"}},
  "saveTo": "~/memory/imports/paper"
}
```

A long document does not finish in one call. The answer is then `status: "pending"` with a `job`. Call again with that
job and the same `saveTo`, and repeat until the status is `complete`:

```json
{
  "tool": "hm://SPACE/datalab",
  "input": {"job": "JOB_FROM_THE_FIRST_CALL"},
  "saveTo": "~/memory/imports/paper"
}
```

Do not send the file again while a job is pending. That starts a second conversion and bills it.

# What comes back

A complete answer has four files:

| Field      | File            | What it is                                                         |
| ---------- | --------------- | ------------------------------------------------------------------ |
| `document` | `seed.md`       | the cleaned Markdown, which you repair and publish                 |
| `raw`      | `raw.md`        | the Markdown exactly as Datalab returned it                        |
| `manifest` | `manifest.json` | pages, mode, quality, cost, images, and every repair the tool made |
| `assets`   | `assets/<name>` | the extracted figures                                              |

It also has these values:

| Value               | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `pages`, `images`   | how many pages were converted and how many figures were extracted       |
| `truncated`         | `true` when the document was cut at the page cap, so the end is missing |
| `captions`          | how many `Figure N: …` paragraphs became captions of their figures      |
| `citationsLinked`   | how many citations the tool linked to an entry of the references        |
| `citationsUnlinked` | how many bracketed citations it left as text, because no entry matched  |
| `markersRepaired`   | how many unpaired `**`, backticks, code fences or `$$` were closed      |
| `parseQualityScore` | Datalab's own score, 0 to 5, when it gives one                          |
| `costCents`         | what the conversion cost, in cents, when Datalab says                   |

Report `parseQualityScore` and `costCents` exactly as returned. If one is missing, say it is missing. Never invent
either.

The tool has already done this to `seed.md`:

- Each figure is on its own line and points at its file in `assets/`.
- One-line `$$…$$` formulas are display math blocks.
- Links that pointed inside the source file are reduced to their text. External links are kept.
- Each entry of the references has an id, written at the end of its line as `<!-- id:ref-… -->`.
- A citation in square brackets whose label matches an entry is a link to it: `[12]`, a list or a range such as
  `[3, 5-7]`, or a label such as `[Smith20]`.

That is all it does. It does not link any other kind of citation, it does not redraw figures, it does not handle
footnotes and it does not extract fields. Those are steps 4, 6, 7 and 8 below, and they are yours.

# After the call

Do every step, in this order. Work in the folder `saveTo` named. Use `execute` for anything a script does better than
reading: rendering a page, listing every citation, comparing text.

## 1. Read the manifest

Read `manifest.json` first. It lists every repair with its line in `raw.md`, every citation left unlinked, and whether
the document was truncated. Each item is a place you must look.

If `truncated` is true, stop and say so. The end of the document is missing. Convert the remaining pages with
`pageRange`, or ask whether a partial import is wanted.

## 2. Compare the text with the source

Seed shows one column of text. The reading order must be the order a person reads the source in, not the order of its
layout.

Check at least the first page, one dense page of text, one page with a table, one page with a figure, and the last page.
For a scanned source, check more: names, numbers, quotes, URLs and formulas are what recognition gets wrong.

- No text is missing, and none appears twice.
- Two columns were not interleaved.
- The title, the authors and every heading are there, at the level the source gives them.
- Special characters and symbols are readable.
- External links work.
- The last paragraph of the source is the last paragraph of the Markdown.

Fix what is wrong in `seed.md`.

## 3. Repair tables and formulas

- Keep a Markdown table only when its headers, its cells and its notes are right. Write `\|` for a pipe inside a cell
  and `<br>` for a line break.
- A table too complex for Markdown becomes an image of the whole table, with a clear transcription of its content beside
  it.
- Read every formula against the source. A formula that lost a symbol is wrong, not almost right.
- For each repaired marker in the manifest, look at that line in `raw.md` and confirm the bold text, the code or the
  formula ends where it should.

## 4. Render every figure whole

A figure drawn with vector shapes, or made of several parts, often arrives as fragments, as one part of the figure, or
not at all. The tool does not redraw it. You do.

1. List the figures of the source: every `Figure N` caption, and every drawing, chart or diagram without one.
2. For each, open the image the tool extracted and compare it with the source page.
3. If the image is not the whole figure, render it yourself. With `execute`, open the source with a PDF library, find
   the page and the region of the figure, and render that region as one image at twice the page resolution or more.
   Install the library in the sandbox if it is missing. Save the image in `assets/`.
4. Replace the fragments in `seed.md` with one image line, at the place where the text introduces the figure.
5. Put the full caption, `Figure N: …`, in the image itself, once. Remove any paragraph that repeats it.
6. Delete the fragments you replaced from `assets/`. Do not add a gallery of leftover images at the end of the document.

A source that is not a PDF, such as a Word file, gives no page to render from. Export it to PDF first, or take the
figure from the file itself.

## 5. Keep the footnotes

The tool has no rule for notes. For every footnote and endnote of the source:

- its marker is in the text, at the same place;
- its text is in the document, with its number, at the end of its section or under a notes heading at the end;
- no marker points at a note that is gone, and no note is left without its marker.

Do not use inline HTML such as `<sup>` to imitate the look of the source.

## 6. Link every citation

Do this for every document that has a list of references, not only for papers. A reader must be able to go from each
citation to its entry.

**Find the references.** The section may be headed `References`, `Reference`, `Bibliography`, `Works Cited`,
`Literature Cited` or `Reference List`. Each entry has an id at the end of its line: `<!-- id:ref-… -->`.

**Find every citation.** Look in the prose, in headings, in table cells and in figure captions. Look for every style,
not only the one the tool found:

- numbers in brackets or parentheses, such as `[12]` and `(12)`;
- groups and ranges, such as `[3, 5-7]`;
- an author and a year in parentheses, such as `(Smith, 2020)` and `(Smith and Jones 2019; Lee et al. 2021)`;
- an author in the sentence with the year in parentheses, such as `Smith (2020)`.

The tool linked only the bracketed ones whose label matched an entry. Link the rest yourself, as `[text](#ref-ID)` with
the id of the entry. For a long document, write a script that lists every citation with its place and the entry it
matches, and review that list before you change the Markdown.

**Link only what is certain.**

- A number links to the entry with that number, and to no other.
- Each number of a group or a range gets its own link.
- An author and a year link only when the names and the year together identify exactly one entry. Compare the names
  without case and accents, and treat `et al.` and `and` as the source does.
- Two works by the same author in the same year need their letter, such as `2020a`.
- If two entries could match, or none does, leave the citation as text. The same goes for a citation that gives several
  years, points at a note, or follows a style of its own. List each one in your report.
- Never link by guessing, and never by nearness on the page.
- Never write a block address yourself. Before publishing, the `ref-…` ids in `seed.md` are the only ones that exist.

**Check each link.** For every link, the tool's and yours, read the entry it points at and confirm it is the work the
citation means.

## 7. Extract structured fields, only when asked

Do this only when the requester named the fields or gave a schema. Never do it on your own.

- Describe each field exactly before you extract it: the authors in the order of the source with their full names as
  printed, or the year of publication as four digits.
- Take each value from the source document, and check it against the page it is on. Do not derive a value from
  `seed.md`, which may be wrong.
- A value that the source does not state is missing. Say so. Never make one up.
- Save the result as `structured-extraction.json` beside `seed.md`, and give it to the requester. It is not part of the
  published document unless they ask.

## 8. Publish

1. Put `name` and `summary` at the top of `seed.md`.
2. Run `write` at the destination with `dryRun: true` and `options.fromPath` naming `seed.md`. Read what it would do,
   and fix what it refuses.
3. Publish with the same call, without `dryRun`. The images that `seed.md` uses are uploaded with it. Each `ref-…` id
   becomes the id of its block, and each `#ref-…` link becomes a link to that block.
4. Publish nothing else from the folder. `raw.md`, `manifest.json` and unused images are working files.

## 9. Read it back and finish the citations

Publishing is not the end. Block ids are final only once the document is published.

1. Read the exact version you published.
2. Check that every image shows, whole.
3. Open every citation link. Each must lead to its entry in the published document.
4. If a link does not, take the exact id of the entry's block from what you read, correct the link, and update the same
   document. Keep the id of every block that stays. A table has ids on the table, on each header column and on each row.
5. Read the new version and check again.
6. Check that the last paragraph of the source is the last paragraph of the document.

## 10. Report

Say what was converted, the page count, the quality score and the cost as returned, what you repaired, which figures you
rendered, how many citations are linked, and every citation you left as text with the reason.

# Checklist before you say it is done

- The destination is the one that was asked for.
- The key was never asked for, shown or stored.
- Text order, headings, tables, formulas, links and the ending match the source.
- Each figure is whole, in place, and has its caption once.
- Every image in the published document shows.
- Every footnote is there with its marker.
- Every citation is linked to its entry, or listed in the report as left for review. No link was guessed.
- Every link was checked against the entry it opens, in the published version.
- Structured fields were extracted only if asked, from the source, with nothing invented.
- The published version was read after the last update.
- The quality score and the cost were reported as returned.

# Without Datalab

A source can also be converted with no Datalab key, by reading the PDF directly. The steps after the conversion are the
same. See the [PDF-to-Seed guide](hm://z6MkwN8HTLPakMbqFz8zNdG6dn8wkw411XRvjbFL6YRiHBfF/pdf/ultimate-guide).
