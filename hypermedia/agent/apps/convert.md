---
name: Datalab converter
summary: Converts PDFs, office documents, EPUBs and images from agent memory into reviewable markdown with the Datalab document parser, on the agents server, without the agent ever holding an API key.
attributesSchema: hm://hyper.media/agent/app
slug: convert
arguments:
  apiKey:
    type: string
    secret: true
    required: true
    order: 1
    description: A Datalab API key. A space's own key is not metered; the key of a server-wide mount is shared with every space and metered.
  mode:
    type: string
    order: 2
    description: The Datalab mode conversions run in unless the call asks for another. On a server-wide mount it is also the most expensive mode a call may ask for.
    choices:
      fast: Fast
      balanced: Balanced
      accurate: Accurate (2.5x the price)
  extras:
    type: string
    order: 3
    description: Comma-separated Datalab extras sent with every conversion, such as `extract_links,chart_understanding`. Not `infographic`, which replaces every figure with its textual reading.
  baseUrl:
    type: string
    order: 4
    description: Operator use. Another Datalab-compatible API root; the default is Datalab's.
network:
  datalab: www.datalab.to
usage:
  meter: per-unit
  unit: pages
  period: month
  callCap: 200
---
This [app](../app.md) has one tool, `convert`. It sends a document from `~/memory/` to the Datalab document parser and writes the markdown and the extracted figures back into memory, next to the source. The agent reviews the markdown, adds metadata, and publishes it with `write ... fromPath`, like any other memory file. The agent never talks to Datalab and never sees a key. How to call it is on the [tool's page](./convert/tools/convert.md), which also carries the code that does it.

# Supported documents

PDF (`.pdf`); Word (`.doc`, `.docx`, `.odt`); spreadsheets (`.xls`, `.xlsx`, `.xlsm`, `.xltx`, `.csv`, `.ods`); presentations (`.ppt`, `.pptx`, `.odp`); web and ebooks (`.html`, `.epub`); images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tiff`). Each file may be up to 100 MiB. An image counts as one page. Markdown and plain text are not documents to convert: read them directly.

# What it writes

The tool writes `raw.md`, `seed.md`, the figures and `manifest.json` next to the source. The [tool page](./convert/tools/convert.md) says what each file is, what the post-processing repairs and links, and how to review `seed.md` before publishing.

# Pages, cost and the page cap

Datalab bills per page. Every conversion has a page cap: the smaller of `max_pages`, the per-document cap (200 pages), and what the call may still spend on a shared key. The cap is what Datalab is told, so a call can never cost more than was set aside for it. A document longer than its cap is converted up to the cap and reported with `truncated: true`; `manifest.json` names the limit that cut it. Convert long documents in parts with `page_range`.

# Keys

The mount the space sees decides whose key a conversion runs on:

1. The space's own mount of this app, with its `apiKey` argument stored on the agents server from the Apps dialog. Pages on it are not counted against anything, and any `mode` goes through.
2. The server-wide mount's shared key, metered per space per UTC month against the allowance and ceiling the operator's mount page declares (`usage.allowance`, `usage.ceiling`). Before each call the server sets pages aside within the per-call cap (`usage.callCap`) and tells the tool its budget; a `mode` more expensive than the mount's is lowered to it, and the result says so.

Without a mount the tool is not offered at all, so the model never sees a tool that can only fail. An exhausted allowance answers with how much was used and that mounting the app with an own key lifts the cap. A space whose agents server has no sandbox, or no key of its own and no server-wide mount, has no `convert`.

# See also

- [convert](./convert/tools/convert.md): the tool: its inputs, what it writes, how to review the result, and its code.
- [Agent Guide](../guide.md)
- [Tools](../tools.md)
- [App](../app.md): the type this page follows.
- [Agent apps](../agent-apps.md): how an app is mounted and run.
