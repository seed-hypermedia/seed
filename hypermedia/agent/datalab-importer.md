---
name: Document converter
summary: The document converter is a tool an app or an agent hosts, which turns a PDF, an office document, an e-book or an image into Seed markdown with Datalab, using the key in its host's private config.
---
The **document converter** is a [tool](../tool.md) named `convert`. It turns one document into markdown that is ready to publish as a Seed [document](../protocol/documents.md), using the Datalab conversion service. An [agent](../agent.md) uses it to import documentation it then works on.

The tool takes a PDF, a Word, PowerPoint or Excel file, their OpenDocument forms, CSV, HTML, EPUB, and PNG, JPEG, WebP, GIF or TIFF images. It does not take markdown or plain text: read those directly.

The [app environment](../software/app-environment.md) does not include the converter. Its code is in the Seed repository at `apps/tools/convert/`, and it runs only where someone has published it under an [app](../app.md) or an agent and run that host. So check first:

- You need the tool's `hm://` URL, such as `hm://SPACE/converter/convert`. If nobody gave it to you, you cannot call it. Convert the document another way.
- The host must run on the server you run on. A tool on another server answers that its app does not run here.

The tool only converts. The agent still reviews the result, does the signed Seed writes and checks what it published.

# Who holds the key

The tool declares one secret, `datalabApiKey`, and its host supplies it. In an app, someone who can write the app's [space](../protocol/spaces.md) enters it in the app's Settings, which asks for it because the tool declares it. The tool gets that field and no other secret the app holds, and sends it only to Datalab.

- Never ask for the key in a conversation, and never put it in memory, in a call's input or in a document.
- Every caller of an app's converter spends that app's key. The app's public config sets the ceilings: `mode` (the most expensive mode, `balanced` unless set) and `maxPages` (the most pages one document may bill, 200 unless set). A call can lower either, never raise it.

# Calls are public, files are not

The server records every call with its input and its output, and anyone can read the record. The record holds the name, type and size of each [file](../tool.md#files), never its bytes. So a document's file name, page count and cost are public, and its text and figures are not, until you publish them.

The tool stores nothing and publishes nothing. The converted files come back in its answer, and the caller decides where they go.

# Convert a document

The tool takes the document as a file inside its input: `file`, an object `{name, mimeType, data}` with the bytes as base64. An agent names the file instead, and the server puts it there:

```json
{
  "tool": "hm://SPACE/converter/convert",
  "input": {"file": {"fromPath": "~/memory/incoming/paper.pdf"}},
  "saveTo": "~/memory/imports/paper"
}
```

For a file attached to the [session](./session.md), write `{"fromAttachment": "ATTACHMENT_ID"}`. The name's extension says what the document is. One document may be 45 MiB at most.

Other input fields are `pageRange` (counted from zero, for example `0-5,10`), `maxPages` and `mode` (`fast`, `balanced` or `accurate`).

The result is one of two:

- `status: "complete"`. The result has the converted files (see below), and `pages`, `images`, `truncated`, `captions`, `citationsLinked`, `citationsUnlinked` and `markersRepaired`, and `parseQualityScore` (0 to 5) and `costCents` when Datalab gives them. Report them exactly as returned. Never invent either value.
- `status: "pending"`. Datalab is still working. Call again with the returned `job` and no file:

```json
{
  "tool": "hm://SPACE/converter/convert",
  "input": {"job": "JOB_FROM_THE_FIRST_CALL"},
  "saveTo": "~/memory/imports/paper"
}
```

A tool call lasts 60 seconds unless the tool sets `timeoutSecs` in its metadata, and 300 seconds at most. A long document takes several calls.

# What comes back

A complete result carries four fields that hold files:

| Field | File name | What it is |
| --- | --- | --- |
| `document` | `seed.md` | the cleaned markdown to review and publish |
| `raw` | `raw.md` | the markdown as Datalab returned it |
| `manifest` | `manifest.json` | pages, mode, quality, cost, images, and every repair |
| `assets` | `assets/<name>` | the extracted figures, as a list |

`document` links to its figures as `assets/<name>`. So with `saveTo`, the files land as a folder that publishes as it is:

```text
imports/paper/
  seed.md
  raw.md
  manifest.json
  assets/
```

Without `saveTo`, each file becomes an attachment of the session, and the images are no longer beside the markdown. Use `saveTo` when you mean to publish.

A [page](../page.md) or another client that calls the tool gets the same four fields with the bytes in them, and saves or publishes them itself.

The tool cleans the markdown before you see it:

- Each figure sits on its own line and points at its file in `assets/`. A `Figure N: …` paragraph next to a figure becomes that figure's caption.
- One-line `$$…$$` formulas become fenced math [blocks](../protocol/blocks.md).
- Links that point inside the source file are reduced to their text. External links are kept.
- Each entry of the references section gets a block id, and each citation that names exactly one entry becomes a `#ref-…` link to it. Publishing turns those into links to the published document. A citation with no matching entry stays as text and is listed in `manifest.json`.
- An unpaired `**`, backtick, code fence or `$$` is repaired, because one of them would hide the rest of the document. `manifest.json` names each repair and its line in `raw.md`.

The converter has no rule for footnotes, and it does not redraw vector figures. Check both by hand.

# Review and publish

1. Read `seed.md` against the source. Check the title, the reading order, tables, formulas, figures, and every line `manifest.json` names.
2. Add frontmatter (`name`, `summary`) at the top of `seed.md`.
3. Publish it with [`write`](./write.md): the document's `hm://` address with `options.fromPath: "~/memory/imports/paper/seed.md"`. The images in `assets/` are uploaded with it. Ask for the address. Never pick one silently.
4. Read the published document back and check it.

# Use the converter from another app

An app or an agent uses the converter by having it among its own tools. In the [desktop app](../software/desktop.md), drag the tool onto the app in the document tree and choose **Move here** or **Copy here**. An agent copies it with `write` and `options.action: "fork"`, at an address directly under the app. The tool brings its declared config with it, so the app's Settings asks for `datalabApiKey`, and shows the app in red until it is set. Enter the key there and run the app. A copy does not follow later changes to the original.

# See also

- [Tool](../tool.md)
- [Call](./call.md)
- [Write](./write.md)
- [Memory](./memory.md)
- [Agent guide](./guide.md)
