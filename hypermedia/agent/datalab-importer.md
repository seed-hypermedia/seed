---
name: Datalab PDF Importer Reference
summary: The Datalab PDF importer is an add-on tool that turns a PDF into Seed markdown with Datalab, and the app environment does not include it, so an agent has it only when someone has added it.
---
The **Datalab PDF importer** is a tool named `datalab_pdf_importer`. It turns a PDF into markdown that is ready to publish as a Seed [document](../protocol/documents.md), using the Datalab conversion service. <!-- id:RrPCYAhg -->

The [app environment](../software/app-environment.md) does not include this tool. It is not one of the built-in [callable tools](./callables.md), and no code in the Seed repository provides it. An [agent](../agent.md) has it only when someone has added it, as a tool resource (see [call](./call.md#tool-resources)) or through an [MCP server](./mcp.md). So check first:

- Run `read ~/tools/`. If the importer is not listed, and nobody gave you its `hm://` URL, you cannot call it. Convert the PDF another way.
- If it is there, read its [contract](./contract.md) before you call it. The contract is the truth. This page describes the tool as its author documented it, and the tool you find may differ.

The tool has two operations: `convert` (the default) and `postprocess_seed`. The tool only prepares files. The agent still does the signed Seed writes and the final check.

# Credential boundary <!-- id:M_qNC5VE -->

Conversion needs the requester's Datalab API key. The caller puts the key in a memory file and passes its path as `api_key_file`. Anyone the agent is shared with can read memory, so do this only on an agent that is not shared, and delete the file when the conversion is done. Never show or publish the key. <!-- id:PWyNZkXB -->

- `postprocess_seed` does not call Datalab and needs no key.
- When the requester chooses local or simple recognition, do not ask for a Datalab key.

# Convert invocation <!-- id:FbOXgBsr -->

```json <!-- id:V04_Y7a8 -->
{
  "operation": "convert",
  "pdfs": ["incoming/paper.pdf"],
  "api_key_file": "datalab-api-key",
  "output_dir": "datalab-imports",
  "prepare_seed": true,
  "render_complete_figures": true,
  "append_unreferenced_images": false,
  "max_concurrency": 2
}
```

PDF paths are relative to the agent's memory. The importer accepts a list of files or glob patterns. It can also find PDFs itself when `pdfs` is left out. Other controls are `max_pages`, `page_range` (counted from zero, for example `0-5,10`), `skip_cache`, `overwrite`, `poll_interval_seconds`, and `timeout_seconds`. <!-- id:-f909P_U -->

The `convert` operation calls Datalab's PDF conversion endpoint. It asks for markdown with links and infographics, image extraction, and a balanced conversion mode. The result includes `parse_quality_score` (0 to 5, or null) and `total_cost` in cents, exactly as Datalab returned them. Never invent either value. <!-- id:ubrVYLm_ -->

# Conversion output <!-- id:7d3qRS6k -->

```text <!-- id:xhjIRuT8 -->
datalab-imports/<stable-document-slug>/
  raw.md                       # raw converter Markdown
  document.md                  # rewritten working Markdown
  seed.md                      # first-pass Seed Markdown
  seed-postprocess.json        # citation/verification plan
  manifest.json                # assets, warnings, quality/cost data
  assets/                      # local extracted and rendered assets
  structured-extraction.json   # only when structured extraction was requested
```

By default the importer cleans the markdown: <!-- id:iy7YRfou -->

- It puts the text in one column, in reading order.
- It keeps external links and removes links that point inside the PDF.
- It turns one-line math into display math.
- It renders complete figures, puts each figure where it was in the source, and uses image captions.
- It does not add a gallery of leftover images at the end.

A person or the agent must still review the result.

# Opt-in structured extraction <!-- id:DMOJGg2j -->

Conversion never extracts structured fields unless you ask. To ask, give exactly one of: <!-- id:qMyrskPx -->
  - `structured_fields`: field names, from which the importer builds a descriptive JSON Schema; <!-- id:DuRdldv2 -->
  - `structured_schema`: a JSON Schema object with `type: "object"` and `properties`; <!-- id:mxRM0crh -->
  - `structured_schema_id`, optionally with `structured_schema_version`, for a schema saved at Datalab. <!-- id:N-lHZz7J -->

Example: <!-- id:WT3764Hp -->

```json <!-- id:GcQqlUoW -->
{
  "pdfs": ["incoming/paper.pdf"],
  "api_key_file": "datalab-api-key",
  "structured_fields": ["title", "authors", "publication_year"],
  "extraction_mode": "accurate"
}
```

The tool asks Datalab for a conversion checkpoint only when extraction is requested. It then sends that checkpoint, not the markdown, to Datalab extraction. The modes are `fast`, `balanced` (the default), and `accurate`. <!-- id:tOdbv805 -->

The tool saves the returned fields, citations, verification data, schema data and scores in `structured-extraction.json`, and also returns them. Describe each field exactly, in the words of the source. Do not make up extracted values from `seed.md`.

# Postprocess invocation <!-- id:2LIvUa1X -->

When the first published version has a bibliography and possible citations, run: <!-- id:OMtAhpv- -->

```json <!-- id:CKhMZtZk -->
{
  "operation": "postprocess_seed",
  "published_seed_url": "hm://ACCOUNT/document-path",
  "published_seed_version": "EXACT_PUBLISHED_CID",
  "postprocess_output_dir": "datalab-imports/document-slug"
}
```

The tool reads the exact published version and finds the bibliography entries. It writes `seed-update.md` and `seed-postprocess-audit.json`. <!-- id:i5oItO3H -->

- It links only safe matches: numbered groups and ranges, and author and year pairs that match one entry. This includes citations in captions and tables.
- It fails when the document holds Seed content it cannot handle. It never drops such content in silence.
- Read the audit before you update. A match that is unclear needs a person or the agent to review it. Never guess.

# See also

- [Callable tools](./callables.md)
- [Call](./call.md)
- [Memory](./memory.md)
- [Agent guide](./guide.md)
