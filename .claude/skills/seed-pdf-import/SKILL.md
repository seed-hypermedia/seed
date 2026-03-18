---
name: seed-pdf-import
description:
  Import PDF documents into Seed Hypermedia using AI-powered content recognition. Use when the user wants to convert a
  PDF file into a Seed document, extract content from PDFs for Seed, or ingest PDF files into the Seed platform. This is
  an LLM-powered alternative to the CLI's built-in `document import` command -- the LLM reads the PDF visually and
  produces structured Seed content with superior OCR, layout recognition, and semantic understanding.
---

# PDF to Seed Document Import

Convert PDFs into Seed Hypermedia documents by reading the PDF, structuring the content, and publishing via the Seed
CLI. Images are extracted, converted to IPFS, and published atomically alongside the document.

For CLI setup, key management, and environment configuration, see the **seed-hypermedia-write** skill.

## Prerequisites

1. **Seed CLI** (`@seed-hypermedia/cli` on npm, binary: `seed-cli`) -- See the **seed-hypermedia-write** skill for
   detection, installation, updates, key management, and environment configuration.
2. **For image extraction** (optional) -- `poppler-utils` for `pdfimages`, or Python `pypdfium2`. See
   [references/pdf-extraction.md](references/pdf-extraction.md).

## Workflow

### Step 1: Read the PDF

**Preferred**: Read the PDF directly using vision capabilities. Analyze each page to understand:

- Document structure (headings, sections, hierarchy)
- Text content with formatting (bold, italic, links, code)
- Images and figures (location, captions)
- Tables, lists, code blocks, math formulas
- Reading order and logical nesting
- Metadata: title, authors, publication date, abstract/summary

**Fallback**: For very large PDFs or when vision is unavailable, use extraction tools documented in
[references/pdf-extraction.md](references/pdf-extraction.md).

### Step 2: Extract Images

If the PDF contains images/figures that should be preserved:

```bash
# Extract embedded images
pdfimages -j document.pdf /tmp/pdf-images/img
# Produces /tmp/pdf-images/img-000.jpg, img-001.jpg, etc.

# Or render specific pages as images for figures
pdftoppm -png -r 300 -f 3 -l 3 document.pdf /tmp/pdf-images/page
```

Or use Python:

```python
import pypdfium2 as pdfium
pdf = pdfium.PdfDocument("document.pdf")
# Render page 3 (0-indexed) at 2x resolution
bitmap = pdf[2].render(scale=2.0)
bitmap.to_pil().save("/tmp/pdf-images/figure1.png")
```

### Step 3: Produce Content

You have two output format options:

#### Option A: Markdown with Frontmatter (Preferred)

Write a markdown file with YAML frontmatter containing all extracted metadata. This is the simplest approach:

```markdown
---
name: 'Paper Title'
summary: 'The paper abstract or a brief summary'
displayAuthor: 'Jane Doe, John Smith'
displayPublishTime: '2024-06-15'
---

# Introduction

Paper content as markdown...

## Methods

![Figure 1: Experimental setup](/tmp/pdf-images/img-000.jpg)

More content...
```

Then publish:

```bash
$SEED_CLI document create -f extracted.md --key <keyname>
```

#### Option B: JSON Blocks (Precise Control)

For precise control over block structure, annotations, and non-standard block types, produce a JSON array of
`HMBlockNode` objects. Use `file:///absolute/path` for image links -- the CLI converts them to IPFS automatically.

See [references/seed-document-format.md](references/seed-document-format.md) for the complete block format reference and
a comprehensive example covering all block types.

Key rules:

- Every block needs a unique `id`: 8 random characters from `[A-Za-z0-9_-]`
- Headings contain their content as `children`
- Lists are a container Paragraph with `childrenType` ("Ordered"/"Unordered") and child Paragraphs
- Annotations use byte-offset `starts`/`ends` arrays within the `text` field
- Images use `"link": "file:///path/to/image.png"` for local files
- Math blocks use LaTeX in the `text` field
- Code blocks use `attributes.language` for syntax highlighting

Then publish:

```bash
$SEED_CLI document create -f blocks.json --name "Paper Title" --display-author "Jane Doe" --key <keyname>
```

Or pipe JSON via stdin:

```bash
cat blocks.json | $SEED_CLI document create --name "Paper Title" --key <keyname>
```

### Step 4: Publish and Verify

Publish using the Seed CLI (see **seed-hypermedia-write** skill for full reference):

```bash
# Create the document
$SEED_CLI document create -f content.md --key <keyname>

# Or with explicit metadata overrides
$SEED_CLI document create -f content.md \
  --name "Paper Title" \
  --display-author "Jane Doe, John Smith" \
  --display-publish-time "2024-06-15" \
  --key <keyname>

# Preview extraction without publishing
$SEED_CLI document create -f content.md --dry-run

# Append to an existing document
$SEED_CLI document update <hm-id> -f additional-content.md --key <keyname>
```

Verify the result:

```bash
$SEED_CLI document get <hm-id> --md
```

## Built-in PDF Extraction

The CLI also has built-in PDF extraction (pdfjs-dist + optional GROBID) which can be used directly:

```bash
# Built-in extraction
$SEED_CLI document create -f paper.pdf --key <keyname>

# With GROBID for better academic paper extraction
$SEED_CLI document create -f paper.pdf --grobid-url http://localhost:8070 --key <keyname>

# Preview extraction result
$SEED_CLI document create -f paper.pdf --dry-run
```

The LLM-powered approach (this skill) produces higher quality results for complex layouts, figures, and multi-column
papers, but the built-in extraction is faster for simple documents.

## Output Format Summary

The JSON output should be valid JSON matching `HMBlockNode[]`:

```
[
  {
    "block": {
      "id": "<8-char-id>",
      "type": "Heading|Paragraph|Code|Math|Image|Video|File|Embed|WebEmbed|Button",
      "text": "...",
      "annotations": [...],
      "attributes": {...},
      "link": "..."        // for Image, Video, File, Embed, WebEmbed, Button
    },
    "children": [...]      // nested HMBlockNode[]
  }
]
```

For the full schema, block type details, annotation format, and a comprehensive worked example, see
[references/seed-document-format.md](references/seed-document-format.md).
