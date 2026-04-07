# Grid Drag & Drop — How It Works

Three separate fixes working together:

## 1. Correct block selection on drag start

**File:** `SideMenuPlugin.ts` — `dragStart` function

Previously, `dragStart` used `event.clientX` (the drag handle's X position) to find which block to drag via coordinate
lookup. The drag handle sits in the left gutter — for grid column 1, that's outside the editor content area entirely, so
`posAtCoords` returned null and fell back to editor center X, which always resolved to the middle column.

**Fix:** `dragStart` now accepts the `hoveredBlock` DOM element (already tracked by `SideMenuView`) and uses
`docView.nearestDesc()` to get the ProseMirror position directly — no coordinate guessing.

## 2. Correct target cell on drop

**File:** `BlockChildren.ts` — `handleGridDrop` function

ProseMirror's default drop handler uses `dropPoint()` from prosemirror-transform which finds the nearest "structurally
valid" insertion point. In a vertical layout that's always correct, but in a CSS grid it snaps to unexpected positions
because it reasons about the document tree, not visual layout.

**Fix:** `handleGridDrop` intercepts all drops into grid containers. It uses `view.posAtCoords()` with the actual cursor
position to find what's under the cursor (which ProseMirror handles correctly for grid cells), then walks up the
document tree to find the `blockNode` at the grid level. Also uses `view.dragging.slice` (the original ProseMirror
slice) instead of the HTML-deserialized slice to avoid clipboard round-trip issues.

## 3. Correct insert direction

**File:** `BlockChildren.ts` — `insertAfter` logic in `handleGridDrop`

Previously `insertAfter` was based on whether the cursor was left or right of the cell's center. Dropping on the left
half of cell3 would insert before cell3 (landing in position 2), which felt wrong when the user intended to drag to
position 3.

**Fix:** `insertAfter` is now based on **drag direction** — comparing the source block's document position to the target
cell's position. If source < target (dragging right), `insertAfter=true` → block lands after the target. If source >
target (dragging left), `insertAfter=false` → block lands before the target. This matches the natural expectation:
dropping on a cell puts your block at that cell's visual slot.
