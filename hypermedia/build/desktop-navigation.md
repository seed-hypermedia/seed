---
name: Desktop window navigation
summary: Document ownership, navigation acknowledgement, and startup window reconciliation.
---

# Desktop window navigation

The desktop main process owns navigation decisions. A [document](../protocol/documents.md)'s active route and any pending route transition reserve
its window until the renderer acknowledges the transition or Electron confirms the window has closed. Versions and [block](../protocol/blocks.md)
selections share document ownership. Edit drafts alias their published document; new drafts alias their placeholder
routes. Inactive history entries do not reserve documents.

## Ownership and routing

The desktop coordinator lives in `frontend/apps/desktop/src/window-navigation-machine.ts`. Electron adapts its effects
in `app-windows.ts`; the renderer bridge is in `utils/navigation-container.tsx`. The document shell's tabs (Metadata,
[Comments](../protocol/comments.md), Activity, Directory, Collaborators, [site](../protocol/sites.md) profile and all documents) share the underlying document's claim.
Settings, Contacts and API Inspector remain singleton routes. Other pages can appear in multiple windows.

Every route-changing action, including Back/Forward, replace, deep links and browser URL resolution, checks the owner.
If another window owns the target, focus that window and apply the requested view there, leaving the source's page and
history cursor unchanged. Exact reopen requests only focus. History movement between identical entries in the same
window still moves its cursor.

Window creation checks both committed and pending claims synchronously before constructing a `BrowserWindow`. Navigation
decisions are serialized globally. A window temporarily owns both its old and new resources until the renderer confirms
the outgoing document has unmounted. Minimizing or blurring a window never releases its claims.

## State machine

Navigation follows `idle → resolving → awaitingReady → awaitingCommit → committing → idle`. Exact reopen requests focus
the owner without adding a history entry. Requests arriving during a transaction queue in order. Unknown outcomes enter
`reconciling` and retain reservations until a renderer reconnect or confirmed closure resolves them.

A window is creating, ready, disconnected, or closed. Focus and visibility do not change document ownership. Close
requests do not release claims: only Electron's confirmed `closed` event does.

## Renderer protocol

The renderer installs `navigation_commit` before sending `navigation_ready`. `navigation_request` carries validated
intent, with the sender's webContents determining its window ID. The main process sends a complete authorized history
and a request ID. The renderer applies it directly, without initiating another ownership lookup, and sends
`navigation_ack` from a passive React effect after the old document actor's cleanup. A resource-keyed Suspense boundary
prevents a loading destination from retaining a hidden outgoing actor. The embedded browser stays mounted separately to
preserve Chromium history.

Acknowledgements must match both window and request ID. Disconnection retains claims; reconnect replays the same history
snapshot, so retries cannot append duplicate entries. A confirmed close removes claims and re-resolves queued requests
from surviving sources. There is no unrestricted local-navigation fallback on transport failure. A stalled renderer can
hold the global navigation queue until it reconnects or its window closes.

## Startup cleanup

Every startup validates saved routes and reconciles active resource identities before creating windows. Prefer the most
recently focused saved window, with window ID as a deterministic tie-breaker. Existing sessions without focus timestamps
use that same ordering. Keep the survivor's route, history, [account](../protocol/identity.md), assistant state and layout. Do not merge histories
or delete drafts. Unresolvable draft references cannot bypass identity checks.

The original session remains a recovery checkpoint until the restored windows are ready. Cleanup runs on every startup,
rather than being a one-time schema migration. Existing duplicates from an older app are handled before their editors
mount after an update; this is not a command that closes already-running editors.

Session reconciliation is implemented in `utils/window-session.ts`. It first removes obsolete history routes while
preserving the surviving cursor, then groups intersecting resource aliases before selecting survivors. Focus recency is
persisted as `lastFocusedAt`; old sessions use window ID ordering. The original `WindowState-v004` stays on disk and a
`WindowRestoreCheckpoint-v001` backup is recorded until every surviving window has reported both its navigation listener
and root UI ready. Windows explicitly closed during restore leave the participant set. A failed restore preserves the
original session and reports the problem instead of silently restoring unchecked duplicates.

Regression coverage includes competing requests, versions, draft aliases, document tabs, stale acknowledgements,
renderer reconnects, cancelled close, startup checkpoints, obsolete history and teardown under Suspense. No draft
content is migrated or deleted by this cleanup.
