# LaTeX Document Importer Plan

Implementation plan for importing LaTeX documents to Hypermedia format.

## Overview

Build a LaTeX-to-Hypermedia importer following the same architecture as the existing markdown importer, using `unified-latex` for parsing.

## Architecture

```
.tex file → unified-latex parse → LaTeX AST
                                      ↓
                              LatexToBlocks()
                                      ↓
                              Block[] array
                                      ↓
                         (same as markdown from here)
                                      ↓
                            Draft creation → Publish
```

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/packages/editor/src/blocknote/core/extensions/Latex/LatexToBlocks.ts` | Core LaTeX to blocks converter |

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/packages/editor/package.json` | Add unified-latex dependencies |
| `frontend/apps/desktop/src/main.ts` | Add IPC handlers for `.tex` files |
| `frontend/apps/desktop/src/preload.ts` | Add LaTeX IPC bridge functions |
| `frontend/apps/desktop/src/components/import-doc-button.tsx` | Add LaTeX import options to UI |

## Dependencies

```json
{
  "@unified-latex/unified-latex-util-parse": "^1.x",
  "@unified-latex/unified-latex-util-visit": "^1.x",
  "@unified-latex/unified-latex-types": "^1.x"
}
```

## LaTeX to Block Mapping

| LaTeX | Block Type |
|-------|-----------|
| `\section{}` | `heading` (level 1) |
| `\subsection{}` | `heading` (level 2) |
| `\subsubsection{}` | `heading` (level 3) |
| `\paragraph{}` | `heading` (level 4) |
| `$...$`, `\(...\)` | inline math (in content) |
| `$$...$$`, `\[...\]`, `equation`, `align` | `math` block |
| `\textbf{}` | bold text style |
| `\textit{}`, `\emph{}` | italic text style |
| `\underline{}` | underline text style |
| `\texttt{}` | code text style |
| `\includegraphics{}` | `image` block |
| `itemize` environment | `bulletListItem` blocks |
| `enumerate` environment | `numberedListItem` blocks |
| `lstlisting`, `verbatim`, `minted` | `code-block` |
| `quote`, `quotation` | `blockquote` |
| `\href{}{}`, `\url{}` | link in content |
| Regular text paragraphs | `paragraph` block |

## Implementation Steps

### Step 1: Add Dependencies
Add unified-latex packages to `frontend/packages/editor/package.json`.

### Step 2: Create LatexToBlocks.ts
Core converter that:
1. Parses LaTeX using `@unified-latex/unified-latex-util-parse`
2. Walks AST using `@unified-latex/unified-latex-util-visit`
3. Converts nodes to Block[] format
4. Handles hierarchy (sections become parents)
5. Processes media references

### Step 3: Add IPC Handlers
Add `open-latex-file` and `open-latex-directory` handlers in main.ts:
- Filter for `.tex` extension
- Read file content
- Build docMap for cross-references

### Step 4: Add IPC Bridge
Expose `openLatexFiles` and `openLatexDirectories` in preload.ts.

### Step 5: Update Import UI
Add LaTeX options to import dialog:
- "Import LaTeX File"
- "Import LaTeX Directory"

## Implementation Status

All files have been created/modified as planned. The implementation is complete.

## Scope

### MVP (Phase 1) - IMPLEMENTED
- [x] Basic document structure (sections, paragraphs)
- [x] Text formatting (bold, italic, underline, code)
- [x] Math blocks and inline math
- [x] Images via `\includegraphics`
- [x] Lists (itemize, enumerate)
- [x] Code blocks (verbatim, lstlisting)
- [x] Blockquotes
- [x] Links (href, url)

### Future (Phase 2)
- [ ] Tables (tabular environment)
- [ ] Bibliography/citations
- [ ] Cross-references (\ref, \label)
- [ ] Custom environments
- [ ] BibTeX file import
- [ ] Figure captions
- [ ] Subfigures

## Testing

Test with sample LaTeX documents containing:
1. Basic text with sections
2. Math equations (inline and display)
3. Lists (nested)
4. Images
5. Code blocks
6. Mixed content
