---
name: Datalab PDF Importer Reference
summary: The Datalab PDF importer reference covers the invocation, outputs, structured extraction, and fidelity behavior of the optional Datalab importer.
---
The callable `datalab_pdf_importer` is an optional high-fidelity conversion route. Its two operations are `convert` (default) and `postprocess_seed`. The tool prepares files; the agent remains responsible for signed Seed writes and final verification. <!-- id:RrPCYAhg -->

# Credential boundary <!-- id:M_qNC5VE -->

Conversion requires the requester's Datalab API key in a caller-provided **private memory file**, supplied as `api_key_file`. Do not expose or publish the key. `postprocess_seed` does not call Datalab and does not need a key. When a requester selects local/simple recognition, do not request a Datalab key. <!-- id:PWyNZkXB -->

# Convert invocation <!-- id:FbOXgBsr -->

```json <!-- id:V04_Y7a8 -->
{
  "operation": "convert",
  "pdfs": ["incoming/paper.pdf"],
  "api_key_file": "private/datalab-api-key",
  "output_dir": "datalab-imports",
  "prepare_seed": true,
  "render_complete_figures": true,
  "append_unreferenced_images": false,
  "max_concurrency": 2
}
```

PDF paths are relative to persistent memory. The importer accepts a file list or glob patterns; it can also discover PDFs when `pdfs` is omitted. Other controls include `max_pages`, zero-indexed `page_range` (for example `0-5,10`), `skip_cache`, `overwrite`, `poll_interval_seconds`, and `timeout_seconds`. <!-- id:-f909P_U -->

The conversion route calls Datalab's PDF conversion endpoint for Markdown with link and infographic extras, image extraction, authenticated polling, and a balanced conversion mode. The working result includes a nullable `parse_quality_score` (0–5) and `total_cost` in cents exactly as returned; never invent either value. <!-- id:ubrVYLm_ -->

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

Default normalization creates a single-column reading order; preserves external links; removes PDF-local block links; expands one-line math into display blocks; renders complete vector/composite figures; places figures in source position; uses native image captions; and does not append an end-of-document fragment gallery. It must still be reviewed. <!-- id:iy7YRfou -->

# Opt-in structured extraction <!-- id:DMOJGg2j -->

Structured extraction is never implied by conversion. Supply exactly one of: <!-- id:qMyrskPx -->
  - `structured_fields`: field names for which the importer builds a descriptive JSON Schema; <!-- id:DuRdldv2 -->
  - `structured_schema`: an explicit JSON Schema object with `type: "object"` and `properties`; <!-- id:mxRM0crh -->
  - `structured_schema_id`, optionally with `structured_schema_version`, for a saved Datalab schema. <!-- id:N-lHZz7J -->

Example: <!-- id:WT3764Hp -->

```json <!-- id:GcQqlUoW -->
{
  "pdfs": ["incoming/paper.pdf"],
  "api_key_file": "private/datalab-api-key",
  "structured_fields": ["title", "authors", "publication_year"],
  "extraction_mode": "accurate"
}
```

The tool requests a conversion checkpoint only when extraction is asked for, then sends that checkpoint, not the Markdown, to Datalab extraction. Modes are `fast`, `balanced` (default), and `accurate`. Returned fields, citations, verification metadata, schema data, and scores are persisted in `structured-extraction.json` and returned by the tool. Describe desired fields precisely and source-orientedly; do not fabricate extracted values from `seed.md`. <!-- id:tOdbv805 -->

# Postprocess invocation <!-- id:2LIvUa1X -->

When the first published version has a bibliography and citation candidates, run: <!-- id:OMtAhpv- -->

```json <!-- id:CKhMZtZk -->
{
  "operation": "postprocess_seed",
  "published_seed_url": "hm://ACCOUNT/document-path",
  "published_seed_version": "EXACT_PUBLISHED_CID",
  "postprocess_output_dir": "datalab-imports/document-slug"
}
```

The tool obtains the exact published state, maps bibliography blocks, and produces `seed-update.md` and `seed-postprocess-audit.json`. It conservatively handles numeric groups/ranges and unique author–year matches, including citations in captions and tables. It fails rather than silently dropping unsupported Seed content. Inspect the audit before updating; unresolved or ambiguous matches require manual review, never guessing. <!-- id:i5oItO3H -->
