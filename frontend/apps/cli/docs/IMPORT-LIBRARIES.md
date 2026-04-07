# File Import Libraries Research

Research into frontend libraries for importing `.docx`, `.xlsx`, and `.pdf` files into the Seed Hypermedia block model (`HMBlockNode[]`).

**Where file import plugs in:** Each format parser produces `HMBlockNode[]`, then the existing `flattenToOperations()` converts those into `DocumentOperation[]` (ReplaceBlock + MoveBlocks ops). From there, the standard signing and publishing flow takes over — no changes needed downstream.

For updates (`document update --replace-body`), the CLI already has `matchBlockIds()` and `computeReplaceOps()` in `block-diff.ts` that diff old vs new block trees and emit minimal operations. File import can use the same path.

---

## DOCX — `mammoth`

- **npm**: `mammoth`
- **Bundle size**: ~160 KB gzipped
- **Browser support**: Yes
- **Structural quality**: Excellent

Converts `.docx` to clean semantic HTML. Maps Word styles to HTML elements:

| Word Style | HTML Output |
|-----------|-------------|
| Heading 1 | `<h1>` |
| Heading 2 | `<h2>` |
| Bold | `<strong>` |
| Italic | `<em>` |
| Lists | `<ol>` / `<ul>` |
| Tables | `<table>` |
| Images | `<img>` (base64) |

Custom style mappings are supported.

**Repo**: https://github.com/mwilliamson/mammoth.js

### SDK Integration

Two possible conversion paths:

**Path A — mammoth → HTML → BlockNote's HTML-to-blocks**

BlockNote (used in `packages/editor`) already has `tryParseHTMLToBlocks()` which converts HTML into its internal block model. From there, the existing editor-to-HMBlockNode conversion can be reused. This path gets the richest output with minimal new code but couples the import to the editor package.

**Path B — mammoth → HTML → custom HMBlockNode[] mapper**

Write a standalone HTML-to-HMBlockNode converter. Walk the DOM tree and map:
- `<h1>`–`<h6>` → `{type: 'Heading', text, annotations}` with heading-level nesting
- `<p>` → `{type: 'Paragraph', text, annotations}`
- `<strong>`, `<em>`, `<code>`, `<a>` → annotation spans with `starts`/`ends` character positions
- `<ul>` / `<ol>` → Paragraph blocks with `childrenType: 'Unordered' | 'Ordered'`
- `<table>` → Code block (current CLI behavior) or future Table block type
- `<img>` → extract base64 data, upload via blob storage, create `{type: 'Image', link: ipfsUrl}`

Then call `flattenToOperations(blocks)` and feed into the standard `document create` or `document update` flow.

**Image handling note:** mammoth extracts images as base64 `<img>` tags. These need to be uploaded to blob storage (UnixFS chunking, ~256KB chunks, via `storeBlobs` with 4MB message limit) and replaced with IPFS CID links before creating the Image blocks.

**CLI usage would look like:**
```bash
seed-cli document create z6Mk... --title "Imported Doc" --docx report.docx --key main
seed-cli document update hm://z6Mk.../doc --replace-docx updated.docx --key main
```

### Alternative: `officeparser`

- **npm**: `officeparser`
- Produces a hierarchical AST (paragraphs, headings, tables, lists, bold/italic)
- Also handles `.pptx`, `.xlsx`, `.odt`, `.pdf`, `.rtf`
- Newer and less battle-tested than mammoth

---

## XLSX — `read-excel-file` or `xlsx` (SheetJS)

### Option A: `read-excel-file` (lightweight, recommended)

- **npm**: `read-excel-file`
- **Bundle size**: ~37 KB gzipped
- **Browser support**: Yes (browser-first design)
- Returns rows as arrays of cells (string/number/Date/boolean)
- Supports schema-based parsing for typed JSON objects
- Does not handle formulas

### Option B: `xlsx` / SheetJS (full-featured)

- **npm**: `xlsx`
- **Bundle size**: ~300–500 KB gzipped
- **Browser support**: Yes
- Handles merged cells, formulas, number formatting
- **Caveat**: npm version stuck at 0.18.5; newer versions distributed via `cdn.sheetjs.com`
- **Docs**: https://docs.sheetjs.com/

### SDK Integration

Spreadsheets don't map to the existing markdown parser at all — they need a dedicated converter.

**Conversion flow:**

```
.xlsx → read-excel-file/SheetJS → rows[][] per sheet
  → for each sheet:
      Heading block (sheet name)
        → Table-like structure as child blocks
  → flattenToOperations(blocks)
  → standard signing/publish flow
```

**Block mapping options:**

1. **As a Code block** (simplest, matches current CLI behavior for tables):
   Render the spreadsheet as a markdown/CSV table string inside a `{type: 'Code', text: csvString}` block. The CLI already renders markdown tables as Code blocks.

2. **As nested Paragraph blocks** (richer but verbose):
   Each row becomes a Paragraph block, cells separated by formatting. Poor UX for large sheets.

3. **As a native Table block** (if/when the block model supports it):
   The `HMBlockNode` schema doesn't currently have a dedicated Table block type. This would require a schema addition (which needs explicit approval per project rules).

**Multi-sheet handling:** Each worksheet becomes a Heading block with the sheet's content as children. The `flattenToOperations()` function already handles nested parent-child block trees via MoveBlocks operations.

**CLI usage would look like:**
```bash
seed-cli document create z6Mk... --title "Q4 Report" --xlsx data.xlsx --key main
# Each sheet becomes a section under the document
```

**Practical recommendation:** Start with Option A (`read-excel-file`) rendering sheets as Code blocks containing markdown tables. This requires zero schema changes and works with the existing pipeline immediately.

---

## PDF — `pdfjs-dist`

- **npm**: `pdfjs-dist`
- **Bundle size**: ~400–800 KB gzipped (heavy)
- **Browser support**: Yes (this is Firefox's PDF engine)
- **Structural quality**: Low — PDFs have no semantic structure

Extracts text items with position coordinates (x, y), font info, and text content per page via `page.getTextContent()`. Does **not** natively give you headings, paragraphs, or tables — you must reconstruct structure from:

- **Headings**: larger font size
- **Paragraphs**: spatial proximity grouping
- **Tables**: grid-aligned text detection
- **Images**: separate rendering pass

**Repo**: https://github.com/mozilla/pdf.js

### SDK Integration

PDF is the hardest format because `pdfjs-dist` returns positioned text items, not semantic blocks. A heuristic layer is needed between the parser and `HMBlockNode[]`.

**Conversion flow:**

```
.pdf → pdfjs getTextContent() → TextItem[] with {str, transform, fontName, ...}
  → heuristic grouping:
      1. Group text items into lines (same Y coordinate within tolerance)
      2. Group lines into paragraphs (vertical gap < threshold)
      3. Detect headings (font size > body font size)
      4. Detect lists (lines starting with "•", "-", "1.")
  → HMBlockNode[] (mostly Paragraph + Heading blocks)
  → flattenToOperations(blocks)
  → standard signing/publish flow
```

**What maps cleanly to HMBlockNode:**
- Large-font text → `{type: 'Heading', text}` with annotations
- Body text groups → `{type: 'Paragraph', text}` with bold/italic from font metadata
- Bullet/numbered patterns → Paragraph with `childrenType: 'Unordered' | 'Ordered'`

**What doesn't map well:**
- Multi-column layouts (text items interleave columns)
- Tables (must detect grid alignment — complex heuristic)
- Images (requires separate canvas rendering per page, then blob upload)
- Headers/footers (appear as regular text items)
- Mathematical formulas (not extractable as LaTeX)

**The existing `parseInlineFormatting()` in `markdown.ts` builds annotation spans from character positions.** The same pattern applies here — as you concatenate text items into a paragraph string, track font changes to create Bold/Italic annotations with correct `starts`/`ends` offsets.

**CLI usage would look like:**
```bash
seed-cli document create z6Mk... --title "Research Paper" --pdf paper.pdf --key main
# Best-effort text extraction with heuristic heading detection
```

**Practical recommendation:** Offer this as a "basic text import" rather than promising structural fidelity. The `--verbose` flag could show warnings about low-confidence heading detection or skipped elements.

### Alternative: `unpdf`

- **npm**: `unpdf`
- **Bundle size**: ~390 KB gzipped
- Cleaner async/await API wrapper around pdf.js
- Methods: `extractText`, `extractLinks`, `getMeta`
- **Repo**: https://github.com/unjs/unpdf
- **SDK note**: `extractText` returns plain string per page — simpler but loses all font/position metadata needed for heading detection. Only viable for plain-text-only import.

---

## Summary

| Format | Difficulty | Library | Bundle Size | Output Quality | SDK Integration |
|--------|-----------|---------|-------------|---------------|-----------------|
| .docx | Easy | `mammoth` | ~160 KB | High — headings, lists, tables, images, formatting | HTML → HMBlockNode[] → `flattenToOperations()` → publish |
| .xlsx | Easy | `read-excel-file` | ~37 KB | Good — cell data as Code/Table blocks | rows → Code blocks with markdown tables → publish |
| .pdf | Hard | `pdfjs-dist` | ~400–800 KB | Low-Medium — mostly plain text, heuristic headings | TextItems → heuristic grouping → Paragraph/Heading blocks → publish |

All three formats converge at the same point: once you have `HMBlockNode[]`, the existing `flattenToOperations()` → `createChange()` → `createVersionRef()` → `client.publish()` pipeline handles the rest unchanged.

DOCX is the clear quick win — mammoth's HTML output maps almost 1:1 to the block model. XLSX is straightforward but limited to table-like rendering. PDF requires the most custom heuristic code for the least structural fidelity.
