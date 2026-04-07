# Grid Layout Testing Plan

## Unit Tests

### Block Conversion (`frontend/packages/shared/src/client/__tests__/`)

**`hmblock-to-editorblock.test.ts`** — add to `describe('childrenType')`:

- **Grid** — `attributes.childrenType: 'Grid'` maps to `props.childrenType: 'Grid'`
- **Grid with columnCount** — `attributes.columnCount: 3` maps to `props.columnCount: '3'` (number to string)
- **Grid with children** — parent block with `childrenType: 'Grid'` + child blocks preserves structure and columnCount

**`editorblock-to-hmblock.test.ts`** — add to `describe('childrenType')`:

- **Grid** — `props.childrenType: 'Grid'` maps to `attributes.childrenType: 'Grid'`
- **Grid with columnCount** — `props.columnCount: '3'` maps to `attributes.columnCount: 3` (string to number)

### Editor Commands (`frontend/packages/editor/src/blocknote/core/api/blockManipulation/__tests__/`)

**`updateGroup.test.ts`** — add `describe('Grid')`:

- **Group to Grid** — `updateGroupCommand` with `turnInto=true` changes `listType` to `'Grid'`
- **Grid to Group** — switching back resets `listType` to `'Group'`
- **Non-first item with turnInto** — changing list type from a non-first grid item with `turnInto=true` changes the
  whole group (verifies `!turnInto` guard at line 61)

**`nestBlock.test.ts`** — add `describe('Grid container')`:

- **Prevents nesting inside Grid** — `sinkListItem` returns false when parent blockChildren has `listType: 'Grid'`

**`unnestBlock.test.ts`** — add `describe('Grid container')`:

- **Prevents unnesting grid children** — `liftListItem` returns false when block's parent group is Grid

### Type Schema Validation

- **HMBlockChildrenTypeSchema accepts 'Grid'** — `HMBlockChildrenTypeSchema.parse('Grid')` succeeds
- **parentBlockAttributes accepts columnCount** — parsing `{ childrenType: 'Grid', columnCount: 3 }` succeeds
- **Rejects invalid childrenType** — `HMBlockChildrenTypeSchema.parse('InvalidType')` throws

---

## E2E / Playwright Tests

Location: `frontend/packages/editor/e2e/tests/`

### Grid Insertion (`grid-layout.e2e.ts`)

**Slash menu insertion**

- Type text, press Enter, type `/`, click "Grid"
- Assert: parent block gets `childrenType: 'Grid'`
- Assert: 3 children exist (empty paragraphs filling the default 3 columns)
- Assert: DOM has `[data-list-type="Grid"]` with `display: grid` computed style

**Formatting toolbar — switch to Grid**

- Create a parent with nested children (type text, Enter, Tab to nest, repeat)
- Select children, open formatting toolbar
- Click `group-type-dropdown` -> "Grid"
- Assert: parent block has `childrenType: 'Grid'`
- Assert: `column-count-dropdown` is visible and shows "3 Columns"

### Column Count

**Change column count**

- Insert a Grid via slash menu (3 columns, 3 children)
- Click `column-count-dropdown` -> "4 Columns"
- Assert: 4 children exist (1 empty paragraph added)
- Assert: `getDocJSON()` shows blockChildren with `columnCount: 4`

**Decrease column count**

- Insert a Grid with 4 columns
- Change to 2 columns
- Assert: all 4 children still exist (no deletion), just reflowed into 2 columns
- Assert: DOM grid has 2 column tracks

### Switching Away from Grid

**From first item**

- Insert a Grid, type text in cells
- Place cursor in first cell
- Click `group-type-dropdown` -> "No Marker"
- Assert: `childrenType` is `'Group'`, all text preserved

**From non-first item (regression for turnInto fix)**

- Insert a Grid, type text in second cell
- Place cursor in second cell
- Click `group-type-dropdown` -> "Bullets"
- Assert: the whole group changes to `'Unordered'`, not just the second item sinking

### Keyboard Guards

**Tab does not indent inside Grid**

- Insert a Grid, focus first cell, type text
- Press Tab
- Assert: block is still a direct child of the Grid (not nested deeper)

**Input rules blocked inside Grid**

- Insert a Grid, focus first cell
- Type `- ` (dash space)
- Assert: no list conversion happened, text is literal `- `

**Enter creates new grid sibling**

- Insert a Grid, focus first cell, type text
- Press Enter
- Assert: new block is a sibling in the same Grid (child count increased)

### Grid DOM Rendering

**CSS grid applied**

- Insert a Grid
- Assert: `[data-list-type="Grid"]` element has `display: grid` computed style
- Assert: `grid-template-columns` matches `repeat(3, 1fr)`

**No indentation**

- Insert a Grid inside a nested context
- Assert: Grid container has `margin-left: 0` (no nested indent)

### Content Inside Grid Cells

**Text blocks**

- Insert a Grid, type text in each cell
- Assert: each cell's block has the typed content

**Heading in grid cell**

- Insert a Grid, in first cell use slash menu to insert Heading
- Type heading text
- Assert: first child block has `type: 'heading'`

### Edge Cases

**Single child in grid**

- Insert a Grid, delete two of the three children
- Assert: grid still renders with 1 item, no errors

**Many items wrapping**

- Insert a 2-column Grid, add 6 children
- Assert: items wrap into 3 rows of 2

---

## Pre-Completion Checks

```bash
# Type check
pnpm typecheck

# Unit tests
pnpm --filter @shm/shared test
pnpm --filter @shm/editor test

# E2E tests
pnpm --filter @shm/editor e2e

# Format
pnpm format:write
```
