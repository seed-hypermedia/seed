# Fragment Citation Highlights

## Problem

Seed documents already support precise references to block fragments, but the target document does not make those incoming references visible when someone reads it.

Today, a user can load a document that is being cited by other documents or comments and have no immediate visual signal that specific text ranges are part of an active conversation or reference graph. This creates a few problems:

- Readers miss important context around why a sentence or paragraph matters.
- Authors cannot easily see which exact fragments are being cited elsewhere.
- Comments and cross-document references feel disconnected from the text they refer to.
- The citation graph exists in the data model, but it is not exposed at the reading/editing surface.

The goal of this feature is to make inbound fragment citations visible directly inside the document, using the same highlight language users already understand from selected block fragments and comments.

<!-- Add screenshot/video: document before citation highlights -->
<!-- Add screenshot/video: document with citation highlights enabled -->

## Solution

Add a document rendering plugin that highlights every inbound citation targeting a block fragment range, such as:

```text
#BLOCKID[START:END]
```

When a document finishes loading, the UI reads all citations for that document, filters them to ranged block-fragment targets, and passes those ranges into an editor decoration plugin.

The plugin renders highlight decorations over the cited text offsets using the existing `bn-range-highlight-focus` visual language, plus citation-specific classes for stacking/overlap behavior.

Core behavior:

- Fragment citations are visible by default when opening a document.
- Highlights are decoration-only and do not mutate document content.
- Highlight updates do not create undo/redo history entries.
- The feature works whether the editor is loaded/read-only or currently editable.
- A toggle in the document three-dot menu lets users show or hide citation highlights in memory.
- Clicking a highlighted fragment opens the related citation context:
  - If exactly one citation exists at that fragment, open it directly.
  - If multiple citations overlap, show a small popover listing each citation.
- Popover rows display:
  - Document citations: document title.
  - Comment citations: author avatar and a 50-character comment preview with ellipsis.
- Overlapping highlights visually stack so dense citation areas appear darker.

For navigation:

- Clicking a document citation opens the source document/window with the source fragment highlighted.
- Clicking a comment citation opens the comment in the right panel.

<!-- Add screenshot/video: single citation direct-open behavior -->
<!-- Add screenshot/video: multiple citation popover -->
<!-- Add screenshot/video: comment citation row with avatar + preview -->

## Scope (time to development)

Estimated implementation scope: **2-4 development days** for the first production-ready version, assuming citation data is already available from the current document citation query.

Breakdown:

| Area | Estimate | Notes |
| --- | ---: | --- |
| Citation filtering + normalization | 0.5 day | Parse inbound mentions and keep only ranged block-fragment targets. |
| Editor decoration plugin | 1 day | Render range highlights without document mutations or history entries. Reuse main block-fragment offset mapping behavior. |
| Click handling + navigation | 0.5-1 day | Direct-open single citation; popover for overlapping/multiple citations. |
| Toggle in document menu | 0.25 day | In-memory toggle, enabled by default. |
| Popover UI polish | 0.5 day | Document title rows, comment avatar rows, preview text, empty/loading states if needed. |
| Tests + rebase validation | 0.5-1 day | Unit tests for offsets/overlaps; typecheck; targeted editor tests; full frontend test pass. |

Current spike status:

- The core editor plugin exists.
- The feature is wired into document rendering.
- Single citation clicks open directly.
- Multiple overlapping citations render a popover.
- Comment citations show avatar + preview instead of “empty comment”.
- The implementation has been reconciled with main’s newer block-fragment highlighting refactor.

## Rabbit Holes

Potential complexity areas to avoid or defer during the first version:

- **Persistent preferences**: keeping the toggle in local storage, account settings, or synced settings. The current version is intentionally in-memory. A future version could support URL parameters or persisted preferences.
- **Server-side precomputation**: deriving citation ranges on the backend or storing highlight indexes. The spike uses the current citation data in memory.
- **Advanced color semantics**: assigning different colors by source type, author, age, or exact/non-exact versions. The first version only needs visible highlight stacking.
- **Complex overlap layout**: rendering separate lanes, gutters, or annotation connectors for overlapping citations. Darker stacked highlights are enough for now.
- **Full citation management UI**: editing, deleting, resolving, or grouping citations from the popover. The popover is discovery/navigation only.
- **Perfect previews for every source type**: document title and comment preview are enough for the meeting/demo. More source metadata can come later.
- **Analytics/instrumentation**: useful later, but not necessary to validate the UX.

## No Gos

Things this feature should explicitly not do in the first implementation:

- Do not change document content to render citation highlights.
- Do not create editor transactions that land in undo/redo history.
- Do not depend on the editor being read-only; it must work while editing too.
- Do not block document rendering while citation metadata is loading.
- Do not persist the toggle yet.
- Do not introduce a new highlight style unrelated to existing block-fragment/comment highlights.
- Do not open a popover when only one citation is present; single citation clicks should navigate directly.
- Do not show placeholder text like “empty comment” for comment citations when comment metadata is available.
