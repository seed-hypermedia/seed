# Agents × HM Tables: Markdown Round-Trip Plan

Status: design proposal, 2026-08-13. Nothing implemented.

## 1. How HM documents encode tables

Three special block types (`frontend/packages/client/src/hm-types.ts:840-875`), plus plain Paragraphs as cells:

- **`Table`** — container block. Carries only the generic parent attributes.
- **`TableColumn`** — childless block whose _only job is identity and order_. Attributes: `width?: number`,
  `isHeader?: boolean` (header column).
- **`TableRow`** — attributes: `isHeader?: boolean` (header row). Its children are the row's cells.
- **Cells are ordinary `Paragraph` blocks** with `attributes.columnId` referencing a `TableColumn` block id
  (`hm-types.ts:225-227`). There is no fourth "cell" type.

Tree shape (editor emits columns first, then rows — `nodeConversions.ts:611-612`):

```
Table
├── TableColumn c1   (order of TableColumn siblings = display column order)
├── TableColumn c2
├── TableRow r1 (isHeader)
│   ├── Paragraph {columnId: c1} "Name"
│   └── Paragraph {columnId: c2} "Age"
└── TableRow r2
    ├── Paragraph {columnId: c1} "Alice"
    └── Paragraph {columnId: c2} "30"
```

Resolution rules (from `nodeConversions.ts` `tableBlockToNode`/`tableNodeToBlock` and
`hmblock-to-editorblock.ts:59-95`):

- A cell belongs to the column whose id matches its `columnId`. **Cell order within a row's children is irrelevant**;
  display order comes from the TableColumn sibling order.
- Orphan cells (columnId matching no column) are dropped. Missing cells render empty.
- Position-0 invariant, normalized on read: only row 0 may carry `isHeader` (header row); only column 0 may carry
  `isHeader` (header column).
- Orphan TableRow/TableColumn outside a Table parent are dropped on load.
- The Go backend (`backend/api/documents/v3alpha/docmodel/`) is block-type-agnostic: a block's unknown top-level CBOR
  keys become inline attributes (`docmodel.go:742-749`), and no table-specific validation exists server-side. All
  invariants are client-side conventions.

### Why this shape (CRDT rationale)

Cell identity is **(row block, columnId)**, not grid position:

- Editing a cell is a text edit on one Paragraph block — never conflicts with edits to other cells.
- Inserting/reordering/deleting a column is a sibling insert/move/delete of one TableColumn block. Existing cells don't
  move or renumber; they stay attached to their column via the stable `columnId`.
- Inserting/reordering rows is a sibling move of TableRow blocks; cells travel with their row.
- Concurrent "add column" + "add row" merge cleanly: the new row simply lacks cells for the new column (rendered empty);
  the new column simply has no cell in the new row. No positional reshuffle can corrupt the grid.

Any agent-facing design must preserve these identities across edits, or it silently destroys the conflict-resistance
(and any comments/citations anchored to cell/row block ids).

## 2. The shared markdown conversion code

All markdown conversion lives in **`@seed-hypermedia/client`** (`frontend/packages/client/src/`) and is shared verbatim
by the CLI, the Agents service, and the desktop assistant:

| Module                                                                                                                               | Direction         | Consumers                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------- |
| `blocks-to-markdown.ts` (`blocksToMarkdown`, `documentToResolvedMarkdown`, `contentToResolvedMarkdown`, `commentToResolvedMarkdown`) | blocks → md       | CLI `markdown.ts`, `draft.ts`; agents `api-service.ts:8812,9435,9449,6228`                      |
| `markdown-to-blocks.ts` (`parseMarkdown`, `markdownBlockNodesToHMBlockNodes`, `flattenToOperations`)                                 | md → blocks → ops | CLI `commands/document.ts:189-198`, `comment-blocks.ts`; agents `api-service.ts:8933,9103,6172` |
| `block-diff.ts` (`createBlocksMap`, `matchBlockIds`, `computeReplaceOps`, `hmBlockNodeToBlockNode`)                                  | update diffing    | CLI `document update`; agents `writeDocumentUpdate` (`api-service.ts:8469`)                     |

Existing id-preservation convention: every emitted block carries a trailing `<!-- id:XXXXXXXX -->` HTML comment;
`parseMarkdown` strips and reuses them; the update path deletes old blocks whose ids don't reappear.

### Current failure modes (why this is urgent)

1. **Read**: `blocksToMarkdown` has no `Table`/`TableRow`/`TableColumn` cases. They fall to `default:` → empty string,
   and cell Paragraphs leak out as bare paragraphs. Table structure is invisible to agents.
2. **Write**: `parseMarkdown` tokenizes `|` table lines but emits them as a **Code block** with the raw text
   (`markdown-to-blocks.ts:737-739`, stale comment "Seed has no native table type").
3. **Destroy-on-edit**: because read loses the table and update diffs old-vs-new by id, _any_ markdown update of a
   document containing a table deletes the entire table subtree (`computeReplaceOps` DeleteBlocks pass) — even when the
   agent edited an unrelated paragraph.
4. **JSON path is lossy too**: `block-diff.ts`'s `SeedBlock` and `hmBlockNodeToBlockNode` only carry
   `childrenType`/`language`/`link`; `columnId`, `isHeader`, `width` are dropped on the update path even for
   `format: 'json'` writes (agents `memory_publish_document` uses this).

## 3. Design: an identity-carrying GFM table dialect

Agents keep speaking markdown. We extend the _existing_ id-comment convention into GFM tables so identity survives the
round trip, and we exploit the encoding's own key insight to keep the noise minimal:

> **A cell's identity is fully determined by (row id, column id).** A row has at most one cell per column, so cell block
> ids never need to appear in markdown — they are re-derived from the old document during diffing.

Only three kinds of identity are carried:

```markdown
<!-- id:TABLEID -->

| Name <!-- col:c1 --> | Age <!-- col:c2 --> |
| -------------------- | ------------------- | -------------- |
| Alice                | 30                  | <!-- id:r1 --> |
| Bob                  | 25                  | <!-- id:r2 --> |
```

- **Table id**: standalone `<!-- id:... -->` line immediately before the table (reuses the existing "container id"
  mechanism; `tokenize`'s `pendingContainerId` is extended from lists to tables).
- **Column ids**: trailing `<!-- col:ID -->` comment _inside each header cell_. Placing the id in the cell (rather than
  a separate metadata row) means it travels with the header text if an agent reorders or renames columns — the id
  follows the content being manipulated. Headerless columns render as `| <!-- col:ID --> |`.
- **Row ids**: trailing `<!-- id:ID -->` _after the final pipe_ of each body row. The line still starts with `|`, so the
  tokenizer's table detection is unchanged.
- **Cell ids: none.** Rebound via (rowId, columnId) at diff time.

Dialect rules:

- Header row: emitted from `TableRow[0]` when `isHeader` is true. HM tables can be headerless but GFM cannot: for
  headerless tables emit an all-empty header row (cells containing only the `col:` comments); on parse, an all-empty
  header row (ignoring comments) means "no header row" → first body row is row 0, `isHeader` unset.
- Header column (`TableColumn[0].isHeader`) and column `width` are **not expressible in GFM**. They are preserved by
  _attribute carry-over_ during diffing (§4), never round-tripped through text.
- Cell text: pipes escaped as `\|`; newlines emitted as `<br>` and parsed back; inline annotations (bold/links/mentions)
  use the existing inline formatter/parser in both directions.
- Plain GFM tables with **no comments at all** must parse fine (fresh agent-authored tables): all ids generated, first
  row is the header row.
- Ragged rows are forgiving: column count = max cells across all rows; columns beyond the header get generated ids and
  empty header text; short rows simply omit cells (valid in the encoding — they render empty).

## 4. Matching & diff algorithm (the tricky part)

Extend the update pipeline in `block-diff.ts`:

**a. Generic attributes.** Extend `SeedBlock` with `attributes?: Record<string, unknown>` and make
`hmBlockNodeToBlockNode`, `flattenToOperations`, `computeReplaceOps`, and `isBlockContentEqual` pass through/compare
attributes generically (fixes failure mode 4 for all block types, not just tables). The wire already supports it:
ReplaceBlock blocks inline unknown keys as attributes.

**b. Table-aware `matchBlockIds`.** When old and new node are both `Table` (explicit id match, else the existing
type+position rule):

1. **Columns**: match by explicit `col:` id first; unmatched new columns then match unmatched old columns by
   _header-cell text equality_, then by position; leftovers get new generated ids. (Header-text fallback rescues agents
   that drop the comments.)
2. **Rows**: match by explicit row id first, then by position _among unmatched rows in order_ (standard LCS-free
   positional fallback, same spirit as today's `matchBlockIds`).
3. **Cells**: for each (matched row, matched column), look up the old cell with that `columnId` under that row and
   **reuse its block id**; otherwise generate. Cell `columnId` is always set to the resolved column id.

**c. Attribute carry-over.** For a matched TableColumn/TableRow/cell, merge old attributes that the dialect cannot
express (`width`, column `isHeader`, future attrs) into the new block before equality comparison, so untouched
properties never churn and are never lost.

**d. Ops emission.** Columns first, then rows, in one `MoveBlocks` per level (matches editor convention). Deleting a
column (header cell removed in markdown) deletes the TableColumn _and every cell carrying its columnId across all rows_
— the recursive delete pass already handles cells under surviving rows once cells stop being "touched"; add an explicit
sweep so no orphan cells are written.

**e. Invariants on write.** Enforce position-0: strip `isHeader` from non-first rows/columns; emit columns before rows;
refuse (or normalize) duplicate `col:` ids.

## 5. Implementation plan

All conversion work lands in `frontend/packages/client` so CLI, agents, desktop assistant, and comment paths inherit it
simultaneously. Agents-side work is docs and prompts only.

**Phase 1 — encoding-faithful emit** (`blocks-to-markdown.ts`)

- Add `Table` case to both the plain and resolved emitters: normalize (columnId → column order, orphans dropped, missing
  cells empty), emit the dialect of §3.
- Option `includeIds: boolean` (default true) so prompt-context rendering can emit clean tables; keep default behavior
  consistent with existing per-block id comments.

**Phase 2 — parse** (`markdown-to-blocks.ts`)

- Replace the code-block fallback: new `table` token carrying parsed rows/cells and captured ids; build
  Table/TableColumn/TableRow/cell BlockNodes.
- Extend `SeedBlock` with generic `attributes` (used by cells' `columnId`, row/col `isHeader`); update
  `markdownBlockNodesToHMBlockNodes` + `flattenToOperations` to pass attributes through (top-level inlined on the wire
  block, nested under `attributes` in HMBlockNode).

**Phase 3 — diff/update** (`block-diff.ts`)

- Generic attribute pass-through + comparison (§4a, §4c).
- Table-aware matching (§4b) and column-cascade deletes (§4d).
- Invariant normalization (§4e).

**Phase 4 — surfaces**

- Agents: update write-verb tool docs (`agents/docs/tools.md`, tool contract text) to document the dialect, especially
  "preserve the `<!-- col:... -->` and row id comments when editing tables"; read verb needs no changes (inherits Phase
  1).
- CLI: no code changes beyond the shared package; verify `document create/update/get` and `draft` round trips.
- Desktop assistant prompt-resolution path inherits automatically (`contentToResolvedMarkdown`).

**Phase 5 — tests** (gate for done)

- `frontend/packages/client/__tests__/markdown-roundtrip.test.ts`: table round trips — full-fidelity (ids preserved,
  attributes carried), fresh plain-GFM table, headerless table, ragged rows, pipe/newline escapes, single-cell edit
  produces exactly one ReplaceBlock, column add/delete/reorder, row insert between existing rows, unrelated-paragraph
  edit leaves table ops empty (regression for destroy-on-edit).
- Agents: extend write-verb tests for a doc containing a table (update-in-place, memory publish json path attribute
  preservation).

## 6. Alternatives considered

- **Structured table verbs (JSON tool API)** instead of markdown: precise, but adds a second editing model to every
  surface (write verb, drafts, memory publish, comments) and doesn't fix the destroy-on-edit hazard in the markdown
  path, which must be fixed regardless. Could be layered later for programmatic workflows.
- **Per-cell id comments**: maximal fidelity, but doubles the noise inside every cell and is unnecessary — (rowId,
  columnId) already determines the cell.
- **Dedicated metadata comment row** (e.g. `<!-- cols: c1 c2 -->` under the separator): easier to emit, but ids detach
  from the content agents actually move, so column reorders mismatch. Header-cell comments keep id and content coupled.
- **Positional-only matching (no comments)**: works for append-only edits but reassigns identity on any insert/reorder,
  rewriting CRDT history and breaking comment anchors on rows below the edit.
