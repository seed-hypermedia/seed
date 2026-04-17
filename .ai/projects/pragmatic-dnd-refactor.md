# Editor Drag and Drop Refactor: Pragmatic Drag and Drop

## Problem

The editor's block drag-and-drop is built on a custom ProseMirror plugin (~670 lines in `SideMenuPlugin.ts`) that suffers from:

- **Unpredictable UX**: Drops land in unexpected positions, especially around grid layouts and nested blocks. Users can't reliably reorder content.
- **Undocumented API usage**: Relies on `(view as any).docView.nearestDesc()` and other internal ProseMirror APIs that can break silently on upgrades.
- **Synthetic event hacks**: Creates fake `DragEvent` objects dispatched to the editor DOM to handle drops outside editor bounds — fragile across browsers.
- **Tangled concerns**: Drag logic, side menu hover detection, drag preview generation, drop cursor rendering, and grid layout handling are all interleaved in a single plugin file, making changes risky.
- **Debug artifacts**: `console.log('here???')` and similar statements left in production code.
- **No state model**: Drag state is scattered across boolean flags (`isDragging`, `menuFrozen`) and mutable DOM references, making it hard to reason about or extend.

## Solution

Replace the block-level drag-and-drop mechanics with **Atlassian's Pragmatic Drag and Drop** library (`@atlaskit/pragmatic-drag-and-drop`), which:

- Is already used in the desktop app for navigation reordering — proven in our stack.
- Provides a structured event lifecycle (`onGenerateDragPreview` -> `onDragStart` -> `onDrag`/`onDropTargetChange` -> `onDrop`) that maps naturally to a state machine.
- Has first-class support for **tree/hierarchical** items via `@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item` (reorder-above, reorder-below, make-child, reparent).
- Has **edge detection** via `closest-edge` for grid layout reordering.
- Provides built-in **auto-scroll** via `@atlaskit/pragmatic-drag-and-drop-auto-scroll`.
- Separates drag source, drop target, and monitor concerns cleanly — each is a standalone function returning a cleanup callback.

The DnD interaction will be modeled as an explicit **state machine** (pure reducer pattern — `idle` -> `previewing` -> `dragging` -> `idle`) making the system predictable, debuggable, and extensible.

**Key design decisions:**

- Pragmatic DnD owns **block-level drags only**. ProseMirror keeps native inline text selection drags.
- Drop indicator rendered as a **React overlay component** (subscribes to state machine via `useSyncExternalStore`).
- **External file drops excluded** — existing `DragMedia/DragExtension.ts` stays untouched.
- **Clean swap** — no feature flag.
- All block moves execute as a **single ProseMirror transaction** for Y.js/CRDT atomicity.

**Architecture:**

```
+-------------------+     +------------------------+     +------------------+
| Side Menu UI      |     | Pragmatic DnD           |     | ProseMirror      |
| (React)           |     | (DOM drag lifecycle)    |     | (Document model) |
|                   |     |                         |     |                  |
| DragHandle        |---->| draggable()             |     |                  |
| DropIndicator     |<----| dropTargetForElements() |---->| single tr for    |
|                   |     | monitorForElements()    |     | delete + insert  |
+-------------------+     +------------------------+     +------------------+

State machine (pure reducer):
  idle --> previewing --> dragging --> idle
               |              |
               +-- cancelled -+
```

**Files touched:** ~15 (5 new, 7 modified, 3 deleted). All within `frontend/packages/editor/`.

## Scope

**Estimated effort**: 3-5 days for a senior developer familiar with the codebase.

- Day 1: Scaffold files, implement state machine + hitbox strategy, delete dead code
- Day 2: Implement block-move-executor + pragmatic-dnd-bridge (core wiring)
- Day 3: Modify DragHandle, BlockNode, SideMenuPlugin (swap integration points)
- Day 4: Implement DropIndicator, cleanup GridDropCursor + old DnD code
- Day 5: Testing, edge cases (multi-block, grid, nested), polish

## Rabbit Holes

- **Customizing drag preview appearance**: The current system clones DOM nodes and hacks CSS classes onto them. A pixel-perfect drag preview is not worth pursuing — a simple opacity-reduced clone or even a placeholder card is sufficient. Don't spend time matching exact editor styling on the preview.
- **Animating block movement**: Pragmatic DnD supports drop animations, but adding smooth block repositioning animations would require integrating with TipTap's NodeView lifecycle in complex ways. Not worth it in v1.
- **Keyboard-driven drag reordering**: Pragmatic DnD doesn't have built-in keyboard DnD. This is a separate accessibility project — don't try to bolt it on here.
- **Optimizing drop target count**: Every block becomes a drop target. For very large documents (500+ blocks), this could theoretically be a concern, but Pragmatic DnD uses event delegation internally and is designed for this scale. Don't prematurely optimize with virtualization.

## No Goes

- **External file/media drops**: Dragging files from the OS desktop into the editor is handled by `DragMedia/DragExtension.ts` and is out of scope. That system works independently.
- **Cross-editor drags**: Dragging blocks between different editor instances (e.g., from one document tab to another) is not supported in this project. The `canDrop` guard scopes drops to the same editor via `editorId`. However, Pragmatic DnD's architecture makes this a natural future extension — removing the `editorId` guard and adding cross-document transaction logic would enable it. Great candidate for a follow-up project.
- **Side menu redesign**: The side menu hover detection, positioning via Tippy, and add-block button are untouched. Only the drag handle's event wiring changes.
- **Block selection refactor**: `MultipleNodeSelection` remains as-is. We use it to detect multi-block selection for drag, but don't refactor the selection system itself.
- **Collaborative cursor awareness during drag**: Showing other users' drag operations in real-time is out of scope. The Y.js transaction ensures the final result syncs correctly.
- **Comment editor DnD**: The comment editor uses the same block system but is much simpler. DnD may work there incidentally but is not a target for testing or optimization.
