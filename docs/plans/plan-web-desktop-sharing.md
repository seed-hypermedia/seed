# Web ↔ Desktop Document Sharing Refactor

> Source plan: this file is the canonical, git-tracked source of truth for the multi-PR refactor that unifies how desktop and web render and edit hypermedia documents. Every Claude Code session in this repo should read this file first and update the **Phase Ledger** at the end.

## Quick navigation

- [Round 1 — Web editing wiring (already shipped)](#round-1--web-editing-wiring-already-shipped)
- [Round 2 — Desktop ↔ Web sharing refactor (active)](#round-2--desktop--web-sharing-refactor-active)
- [Phase Ledger](#phase-ledger)
- [Working with this plan in Claude Code](#working-with-this-plan-in-claude-code)

---

# Round 1 — Web editing wiring (already shipped)

## Problem (recap)

Editing was desktop-only. Vault-delegated web users could read and comment but not author. Backend, signing, and the shared `documentMachine` were ready; only the wiring was missing.

## Solution (delivered)

The web app now uses the same `documentMachine` as desktop, with web-flavored actor implementations:

- **`writeDraft`** persists to IndexedDB (`web-doc-drafts-01` store).
- **`publishDocument`** signs client-side with the WebCrypto P-256 key, calls `seedClient.publishDocument` via the universal client, then refetches.
- **`pushDocument`** is a no-op on the web in V1.

Capability resolution (`useWebCanEdit`) runs entirely client-side after hydration and applies a site-scope rule: gateway = anywhere user has capability; custom-domain = only docs under the site's home.

V1 surface delivered: text/headings, document metadata (name/icon/cover), embeds, IPFS image upload, navigation diff at publish, vault-delegated identity gating, capability-aware Edit visibility.

## Files written / modified (Round 1, for reference)

- `frontend/apps/web/app/document-edit/web-draft-db.ts` (new) — IndexedDB store + cleanup.
- `frontend/apps/web/app/document-edit/use-web-can-edit.ts` (new) — capability + site-scope hook.
- `frontend/apps/web/app/document-edit/web-document-actors.ts` (new) — `createWebDocumentMachine` + `publishWebDocument` actor algorithm.
- `frontend/apps/web/app/document-edit/web-editing-toolbar.tsx` (new — to be deleted in Round 2 Phase 1).
- `frontend/apps/web/app/document-edit/web-image-upload.ts` (new) — IPFS upload via `filesToIpfsBlobs` + `seedClient.publish`.
- `frontend/apps/web/app/web-resource-page.tsx` (modified) — wired machine, drafts, capability, toolbar (currently `machineExtras` slot, to move to `editingFloatingActions`).
- `frontend/packages/shared/src/utils/navigation-changes.ts` (new) — `getNavigationChanges` lifted from desktop.
- `frontend/packages/shared/src/models/use-unpublished-change-count.ts` (new) — change-count hook lifted from desktop, later extended in Round 2 to count navigation diff.

## Outcome

- 20 new web-side unit tests, all green.
- Web 75 / shared 715 / desktop 413 tests passing post-merge.
- Vault-delegated user can edit + publish a paragraph end-to-end on a local gateway.

---

# Round 2 — Desktop ↔ Web sharing refactor (active)

## Problem

After Round 1 shipped, three divergences violate the project's "shared UI, divergent side effects" principle:

1. **Toolbar UX divergence.** Web's `WebEditingToolbar` is a custom floating bar pinned bottom-right via `machineExtras`. Desktop's `EditingDocToolsRight` (Edit + Publish-with-popover + SaveIndicator + dropdown menu) sits top-right via `editingFloatingActions`. Same data flow, two distinct UIs.
2. **Publish reliability bug.** Web users press Publish and nothing happens. The shared machine only handles `publish.start` from `editing.draft.idle`. Clicks during `editing.draft.changed` (within 500 ms of typing) or while `saving`/`creating` is in flight are silently dropped. Desktop's popover masks this — first-click opens popover, second-click confirms; the delay lets autosave finish. Web's single-button has no such delay.
3. **Code-level duplication.** `SaveIndicator`, edit/publish event wiring, capability resolution, comment-reply navigation, and the lazy `DocumentEditor` boundary are all reimplemented in the web app. Each divergence is small but compounds: every change to desktop's flow risks silently breaking the web counterpart.

## Solution

Pull the editing UI down into `@shm/ui` and `@shm/shared`, parameterized by platform-injected callbacks. Replace web's bespoke toolbar/canEdit logic with the same components desktop uses. Fix the machine so `publish.start` is honored from any in-editing sub-state.

### Architecture (after)

```
ResourcePage  (frontend/packages/ui/src/resource-page-common.tsx)
└── DocumentMachineProvider(machine = host-built actors)
    ├── DocumentEditor                          (shared, lazy via shared hook)
    ├── EditingDocToolsRight                    (shared @shm/ui — top-right slot)
    │     ├── SaveIndicator                     (shared)
    │     ├── PublishButtonWithPopover          (shared, with platform callbacks)
    │     │     └── PublishPopoverBody          (shared, with platform callbacks)
    │     ├── newButton                         (host-injected)
    │     └── OptionsDropdown                   (shared, host-injected items)
    └── EditNavHeaderPane → EditNavPopover       (shared @shm/ui)

Host responsibilities (desktop and web each provide):
  • machine actors: writeDraft / publishDocument / pushDocument
  • signer factory + identity stream (selectedIdentity / signingIdentity)
  • fileUpload(file) → CID
  • document URL resolver (gateway URL, custom-domain rewrite)
  • discard-draft confirmation dialog (or simple confirm)
  • preview-window opener (desktop only; no-op on web)
  • slug helpers (path normalization for first-publish)
  • CommentEditor component
```

### Decisions (locked)

- **Web publish popover = same as desktop**, including URL preview, editable permalink on first publish, "Last published" row, change count, "Open Preview" (no-op on web in V1 — button hidden), Cancel.
- **Lift `EditNavHeaderPane` + `EditNavPopover` to `@shm/ui`** — both are already pure (zero `@/` imports), so the lift is mechanical.
- **canEdit unification: shared shape, platform-specific source** — drop web's `useWebCanEdit` and use the existing shared `useSelectedAccountCapability(docId)` + `roleCanWrite()`. Add a thin `useResourceEditAccess(docId, opts?)` wrapper that layers the site-scope rule (gateway = anywhere; custom-domain = under `originHomeId.uid` only).
- **V1 menu lift = Copy Link only.** Move/Duplicate/Branch/Export/Delete/Publish-Site stay desktop-only.

### Shared API surface (added/changed)

| Symbol | Location | Notes |
|---|---|---|
| `EditingDocToolsRight`, `DraftActionsToolbar`, `PublishButtonWithPopover`, `PublishTrigger`, `SaveIndicator`, `PublishPopoverBody` | `@shm/ui/editing-toolbar` (new) | Lifted from `frontend/apps/desktop/src/components/editing-toolbar.tsx`. |
| `EditNavHeaderPane`, `EditNavPopover` | `@shm/ui/edit-nav-header-pane`, `@shm/ui/edit-navigation-popover` (new) | Lifted from desktop equivalents. Already pure. |
| `useResourceEditAccess(docId, opts?)` | `@shm/shared/models/use-resource-edit-access` (new) | Wraps `useSelectedAccountCapability` + `useUniversalAppContext` + site-scope rule. |
| `useCommentTargetNavigation(docId)` | `@shm/shared/comments-service-provider` (extend) | Extracts duplicated `onReplyClick`/`onReplyCountClick`. Optional `onCommentDraftFocus` callback for desktop-only. |
| `useLazyDocumentEditor()` | `@shm/ui/use-lazy-document-editor` (new) | Returns `React.ComponentType<DocumentContentProps> \| undefined`, lazy-imports `@shm/editor/document-editor` on the client. |
| `createDocumentMachineFromActors({writeDraft, publishDocument, pushDocument})` | `@shm/shared/models/document-machine-host` (new) | Tiny `useMemo` boilerplate eliminator. |

### Platform-injected callbacks for the shared toolbar

```ts
type PublishButtonWithPopoverProps = {
  docId: UnpackedHypermediaId
  existingMenuItems: MenuItemType[]
  /** Resolve the public URL where this doc is/will be available. Desktop uses gateway/site rewrite; web uses origin. */
  getDocumentUrl?: (docId: UnpackedHypermediaId) => string | null
  /** Open a preview window for the draft. Desktop opens an Electron window; web hides the button when undefined. */
  onOpenPreview?: (draftId: string | null, docId: UnpackedHypermediaId) => void
  /** Confirm + perform discard. Desktop opens delete-draft dialog; web shows a simple confirm and sends edit.discard. */
  onDiscardConfirm?: (draftId: string, send: (e: DocumentMachineEvent) => void) => void
  /** Path-segment slugifier for the first-publish editable permalink. */
  slugify?: (raw: string) => string
  /** First-publish slug suggestion (e.g. desktop's `computeInlineDraftPublishPath`). */
  computeFirstPublishPath?: (parentPath: string[], title: string, draftId: string) => string[]
  /** Override route for "View versions" inside the popover. */
  onGoToVersions?: (docId: UnpackedHypermediaId) => void
}
```

Web passes a minimal subset (`getDocumentUrl`, `onDiscardConfirm`, `slugify`, `onGoToVersions`); preview is undefined → "Open Preview" button hidden.

### Files touched

**Lifted (desktop → shared):**
- `frontend/packages/ui/src/editing-toolbar.tsx` (new) ← `frontend/apps/desktop/src/components/editing-toolbar.tsx`
- `frontend/packages/ui/src/edit-nav-header-pane.tsx` (new) ← `frontend/apps/desktop/src/components/edit-nav-header-pane.tsx`
- `frontend/packages/ui/src/edit-navigation-popover.tsx` (new) ← `frontend/apps/desktop/src/components/edit-navigation-popover.tsx`
- `frontend/packages/shared/src/models/use-resource-edit-access.ts` (new)
- `frontend/packages/shared/src/models/document-machine-host.ts` (new)
- `frontend/packages/ui/src/use-lazy-document-editor.ts` (new)
- `frontend/packages/shared/src/comments-service-provider.tsx` — add `useCommentTargetNavigation`
- `frontend/packages/shared/src/models/document-machine.ts` — accept `publish.start` from any editing sub-state (Phase 2)

**Desktop, modified:**
- `frontend/apps/desktop/src/pages/desktop-resource.tsx` — import shared toolbar + nav pane, pass platform callbacks, drop now-shared logic.
- `frontend/apps/desktop/src/components/editing-toolbar.tsx` — collapse to thin re-exports + desktop-specific defaults.
- `frontend/apps/desktop/src/components/edit-nav-header-pane.tsx` — re-export.
- `frontend/apps/desktop/src/components/edit-navigation-popover.tsx` — re-export.

**Web, modified:**
- `frontend/apps/web/app/web-resource-page.tsx` — drop `WebEditingToolbar`/`machineExtras`. Use `editingFloatingActions={({menuItems}) => <EditingDocToolsRight ... />}`. Replace `useWebCanEdit` with `useResourceEditAccess`. Pass `editNavPane`. Drop `useClientDocumentEditor` in favor of shared `useLazyDocumentEditor`.
- `frontend/apps/web/app/document-edit/web-editing-toolbar.tsx` — **deleted**.
- `frontend/apps/web/app/document-edit/use-web-can-edit.ts` — keep `resolveWebCanEdit` (pure helper) but inline its logic into `useResourceEditAccess`'s site-scope option; delete the React hook variant once migration lands.

### Phasing

Each phase is a self-contained PR. Run typecheck + tests after each.

#### Phase 0 — Document Options Panel on web (cheap unblock)

Already shared in `@shm/ui/options-panel` (397 lines), already wired via `DocumentOptionsPanel` in `resource-page-common.tsx:1942`, already routed via `panelKey === 'options'`. Single line gate at `resource-page-common.tsx:1258`:

```ts
if (!IS_DESKTOP) return null
```

Drop the gate. The `canEdit` check on the next line already handles eligibility correctly.

Cleanup that travels with the gate removal:
- Delete `frontend/apps/desktop/src/components/options-panel.tsx` (dead code — no importers).

Verification: open web doc as vault-delegated owner → `…` dropdown → "Document Options" appears → click → panel slides in → metadata fields editable → changes auto-save into IDB draft → publish via shared toolbar.

#### Phase 1 — Lift editing toolbar to shared
1. Create `frontend/packages/ui/src/editing-toolbar.tsx`. Move `SaveIndicator`, `PublishTrigger`, `PublishButtonWithPopover`, `EditingDocToolsRight`, `DraftActionsToolbar`, `PublishPopoverBody`, `formatRelativeTime`. Replace desktop-only imports with platform callback props.
2. Desktop `editing-toolbar.tsx` becomes a thin wrapper supplying callbacks (`getDocumentUrl` via `useDocumentUrl`, `onOpenPreview` via `client.createAppWindow`, `onDiscardConfirm` via `useDeleteDraftDialog`, `slugify` via `pathNameify`, `computeFirstPublishPath` via `computeInlineDraftPublishPath`, `onGoToVersions` via `useNavigate`).
3. Web `web-resource-page.tsx`: build `getDocumentUrl` returning `${origin}${idToUrl(docId, ...)}`, no preview, simple `confirm()` discard, `slugify` via shared util.
4. Replace web's `machineExtras={<WebEditingToolbar/>}` with `editingFloatingActions={...}`. Delete `web-editing-toolbar.tsx`.

#### Phase 2 — Fix `publish.start` from any editing sub-state
1. In `frontend/packages/shared/src/models/document-machine.ts`, allow `publish.start` from `editing.draft.changed` and `editing.draft.saving|creating`. From `idle`: transition to `publishing` directly. Otherwise: set `pendingPublish: true` in context, finish in-flight save, then on `_save.completed` transition to `publishing` if `pendingPublish` set; clear flag on entry to `publishing`.
2. Add unit tests in `document-machine.test.ts` covering: publish during `changed`, publish during `saving`, publish during `creating`, double-click during save (single publish only).

#### Phase 3 — Unify `canEdit` resolution
1. Create `useResourceEditAccess(docId, {requireDelegated?: boolean, applySiteScope?: boolean})`. Internally calls `useSelectedAccountCapability(docId)` + `roleCanWrite` + (when `applySiteScope`) `useUniversalAppContext().origin`/`originHomeId`.
2. `requireDelegated: true` (web V1) gates on `userKeyPair.delegatedAccountUid`. Read via existing `signingIdentity` stream so the hook stays platform-agnostic.
3. Desktop swaps `useSelectedAccountCapability(docId)` → `useResourceEditAccess(docId)`.
4. Web replaces `useWebCanEdit(docId)` → `useResourceEditAccess(docId, {requireDelegated: true, applySiteScope: true})`. Delete `use-web-can-edit.ts` after migration.

#### Phase 4 — Lift `EditNavHeaderPane` + `EditNavPopover` to shared
1. Move both files into `@shm/ui` (already pure). Replace desktop files with `export * from '@shm/ui/...'`.
2. Wire into web: `web-resource-page.tsx` passes `editNavPane={canEdit && !docId.path?.length ? <EditNavHeaderPane homeId={hmId(docId.uid)} /> : undefined}`.
3. Verify the popover's existing search-picker (`useSearch`, `useDirectory`) works under web's universal client.

#### Phase 5 — Shared comment reply navigation
1. Add `useCommentTargetNavigation(docId, {onCommentDraftFocus?})` in `@shm/shared/comments-service-provider`. Replace duplicated callbacks in `desktop-resource.tsx` and `web-resource-page.tsx`.

#### Phase 6 — Lazy editor hook + actor-provider helper
1. Create `useLazyDocumentEditor()` in `@shm/ui` (lift from web's `useClientDocumentEditor`).
2. Create `createDocumentMachineFromActors(actors)` in `@shm/shared/models/document-machine-host`. Both desktop and web call it instead of inlining `documentMachine.provide({actors})` + `useMemo`.

#### Phase 7 — Copy Link menu item on web
1. Verify `useCommonMenuItems` (`resource-page-common.tsx:108`) is wired into ResourcePage's menu pipeline. Web needs a path to forward those items to the shared `OptionsDropdown` rendered inside `EditingDocToolsRight`. Add a default `existingMenuItems = useCommonMenuItems(docId)` fallback when host doesn't supply `extraMenuItems`.

#### Phase 8 — Tests + verification
- Update `web-document-actors.test.ts`, `use-web-can-edit.test.ts` to target `useResourceEditAccess`.
- Add machine tests for the new `publish.start` transitions.
- Run `pnpm typecheck`, `pnpm test`, `pnpm format:write`.
- Manual smoke: gateway own-doc edit → Publish (during typing, during save, during idle) → confirm new version. Custom-domain off-site doc → Edit hidden. EditNavPopover on web home doc → reorder + publish.

### Verification

Final manual smoke against local daemon:

- **Identical UI**: side-by-side desktop + web of same doc — `Edit` / `Publish` buttons in same top-right slot; same popover layout (URL row, change count row, last-published row, action buttons); same `SaveIndicator` pill behavior.
- **Publish reliability**: in web, type → click Publish within 500 ms → version increments. Type → wait for "Saved" → Publish → version increments. Type → click Publish during "Saving…" → version increments after one save round-trip.
- **Capability gate parity**: writer-cap user on a child doc — both apps show Edit; revoke cap — both apps hide Edit on next render.
- **Navigation editing**: web home doc → click pencil → reorder → publish. Item appears in site header on both desktop and web.
- **Tests**: web 75+, shared 715+, desktop 415+. No regressions.

## Scope

**In:**
- Toolbar lift, publish-popover parity.
- `EditNavHeaderPane` + `EditNavPopover` lift; web home-doc nav editing.
- `useResourceEditAccess` shared hook; web migrates off `useWebCanEdit`.
- Comment reply navigation hook.
- Lazy editor hook + actor-provider helper.
- Copy Link in shared menu items, surfaced on web.
- Machine fix: `publish.start` honored from `changed`/`saving`/`creating`.
- Document Options Panel surfaced on web.

**Out (V1 of refactor):**
- Move/Duplicate/Branch/Export/Delete/Publish-Site menu items.
- Inline child draft cards.
- Real-time collaboration.
- Server-side draft sync.
- Convergence of `fileUpload` implementations (correctly diverged by design).

## Rabbit Holes

- **Bundle size on web.** `EditNavPopover` pulls Pragmatic DnD into `@shm/ui`. Web already includes `@atlaskit/pragmatic-drag-and-drop` indirectly via the editor — verify no new transitive cost. If it balloons, lazy-import inside `EditNavHeaderPane`.
- **`PublishPopoverBody` desktop preview button.** Desktop opens an Electron window via `client.createAppWindow.mutate`. Web has no analogue. Hide the button when `onOpenPreview` is undefined; do not fake a "preview tab" on web.
- **First-publish slug rename on web.** Desktop's `computeInlineDraftPublishPath` lives in `frontend/apps/desktop/src/utils/publish-utils.ts`. Lift to `@shm/shared/utils/publish-paths.ts` so both share the suggestion algorithm.
- **`useDocumentUrl` site-rewrite.** Desktop reads `siteHomeResource.data?.document?.metadata?.siteUrl`; web reads `origin`. Provide a single shared helper `useDocumentPublicUrl(docId)` that branches.
- **`publish.start` queueing semantics.** Naïvely raising `publish.start` from `_save.completed` lets a double-click double-publish. Solution: single boolean `pendingPublish`, set in entry of editing sub-states, cleared on `publishing` entry.
- **EditNavPopover popover styling on web.** `@shm/ui/components/popover` is already shared. Verify shadcn/popover renders correctly inside web's portal.
- **Migration coupling.** Each phase ships independently. Don't combine.

## No-Gos

- **No fork of `documentMachine`.** All transitions remain in the shared machine.
- **No re-implementing the editor.** Web and desktop both render `@shm/editor/document-editor`.
- **No silent platform branches inside shared components.** Any divergence is expressed as a host-injected callback prop, not a buried `if (typeof window === 'undefined')` switch.
- **No `@/` imports in `@shm/ui` or `@shm/shared`.** Lifted code that depends on app-internal helpers must take callbacks instead.
- **No regression of Round 1 capabilities.** All web editing flows that work today must keep working: vault-delegated identity, IDB drafts, IPFS image upload, navigation diff at publish, custom-domain site scope.
- **No "small refactor in shared, small fix in web" combined PRs.** Each phase ships in isolation so revert is trivial.

## Execution strategy

**Sequencing principles:**

1. **Land "shared infra is correct" fixes first.** Phase 0 (Options Panel gate) + Phase 2 (machine fix) derisk every later UI lift. Both trivial, both immediately user-visible improvements, both independently revertable.
2. **Parallelize the lifts.** Phases 3 (canEdit), 4 (EditNavHeaderPane), 5 (comment nav hook), 6 (lazy editor + actor helper) touch disjoint files. Two engineers can run two tracks concurrently.
3. **Phase 1 (toolbar lift) is critical path.** Largest single PR, highest platform-divergence risk. Lands after derisk PRs. Two reviewers.
4. **Defer Phase 7 (Copy Link)** until the toolbar lift lands; depends on the shared menu pipeline being live.

**Suggested PR cadence (8 PRs):**

| # | Phase | Gates | Expected size | Parallel-safe with |
|---|-------|-------|---------------|--------------------|
| 1 | Phase 0 — Options Panel gate removal + dead-file delete | none | ~5 lines | All |
| 2 | Phase 2 — Machine `publish.start` flush + tests | none | ~80 lines | All |
| 3 | Phase 3 — `useResourceEditAccess` + web migration | none | ~150 lines | 1, 2, 4, 5, 6 |
| 4 | Phase 4 — Lift `EditNavHeaderPane` + `EditNavPopover` to `@shm/ui` | none | ~100 lines moved + 20 wire | 1, 2, 3, 5, 6 |
| 5 | Phase 5 — `useCommentTargetNavigation` + apply both apps | none | ~120 lines | 1, 2, 3, 4, 6 |
| 6 | Phase 6 — `useLazyDocumentEditor` + `createDocumentMachineFromActors` | none | ~60 lines | 1, 2, 3, 4, 5 |
| 7 | Phase 1 — Lift editing toolbar to `@shm/ui`, replace `WebEditingToolbar` | depends on web cleanup ordering | ~500 lines moved + 100 platform shims | none (touches both apps) |
| 8 | Phase 7 + Phase 8 — Copy Link surfaced on web; tests + manual QA | depends on PR 7 | ~50 lines + tests | none |

PRs 1–6 land in parallel. PR 7 is the bottleneck. PR 8 closes the loop.

**Risk mitigation:**

- **Snapshot tests** on shared `EditingDocToolsRight` for both desktop and web before PR 7. If we break visual layout, snapshot diff catches it.
- **Add an integration test** in `tests/` for the full gateway publish flow (vault-delegated user → edit → publish) before PR 7.
- **Don't combine refactors with feature work.** If a phase exposes a bug, file a follow-up.
- **Run `pnpm typecheck`, `pnpm test`, `pnpm format:write`** locally before every push.
- **One reviewer per PR**, two reviewers for PR 7.

**Estimated effort:**

- PR 1, 2, 6: half-day each.
- PR 3, 4, 5: one day each.
- PR 7: 2–3 days.
- PR 8: half-day.
- Total: ~8 working days solo.

With two engineers (Track A: PRs 1, 2, 7; Track B: PRs 3, 4, 5, 6, 8): ~5 working days end-to-end.

**Stop conditions** (re-plan if any of these surface):

- Toolbar lift (PR 7) reveals desktop's `PublishPopoverBody` depends on side-effect timing not capturable through props (e.g., synchronous tRPC inside click handler with no web analogue). Fall back to "shared shell + platform-specific popover body".
- `EditNavPopover` ships, but drag-and-drop UX breaks on web (touch / mobile). Gate the popover lift behind a `canDragDrop` prop; ship a fallback list editor first.
- `useResourceEditAccess` matrix tests reveal a vault-delegation edge case where signer pubkey ≠ delegate UID. Re-evaluate Round 1 capability resolution before continuing.

---

# Phase Ledger

Track each PR's status. Update at end of each session — append PR number, status, surprises, decisions.

| Phase | Status | PR | Owner | Worktree | Started | Done | Notes |
|-------|--------|----|----|----------|---------|------|-------|
| Round 1 — Web editing wiring | ✅ done | (initial) | Horacio | main | — | 2026-05 | IDB drafts, capability hook, web actors, toolbar (bottom-right — to be moved in Phase 1), image upload, cleanup. |
| Phase 0 — Options Panel gate removal + delete dead desktop options-panel.tsx | ⬜ pending | — | — | — | — | — | One-line removal at `resource-page-common.tsx:1258`. Verify menu item appears on web. |
| Phase 2 — Machine `publish.start` flush from `changed`/`saving`/`creating` + tests | ⬜ pending | — | — | — | — | — | Machine context flag `pendingPublish`. Add 3 unit tests in `document-machine.test.ts`. |
| Phase 3 — `useResourceEditAccess` shared hook + desktop & web migration | ⬜ pending | — | — | — | — | — | Web drops `useWebCanEdit`. Site-scope rule moves to `applySiteScope` opt. |
| Phase 4 — Lift `EditNavHeaderPane` + `EditNavPopover` to `@shm/ui` + wire into web | ⬜ pending | — | — | — | — | — | Both files already pure. Mechanical lift. |
| Phase 5 — `useCommentTargetNavigation` shared hook + apply both apps | ⬜ pending | — | — | — | — | — | Optional `onCommentDraftFocus` callback for desktop. |
| Phase 6 — `useLazyDocumentEditor` + `createDocumentMachineFromActors` | ⬜ pending | — | — | — | — | — | Drops `useClientDocumentEditor` from web; collapses actor `useMemo` boilerplate. |
| Phase 1 — Lift editing toolbar to `@shm/ui` + replace web toolbar | ⬜ pending | — | — | — | — | — | Critical path. Two reviewers. ~500 lines moved + ~100 platform shims. |
| Phase 7 — Copy Link in shared menu items, surfaced on web | ⬜ pending | — | — | — | — | — | Depends on Phase 1 (menu pipeline). |
| Phase 8 — Tests + manual QA pass | ⬜ pending | — | — | — | — | — | Snapshot tests, integration test, full gateway publish smoke. |

**Status legend**: ⬜ pending · 🟡 in-progress · ✅ done · ❌ blocked · 🔁 reverted

---

# Working with this plan in Claude Code

## 1. Plan lives here

This file is the single source of truth. Every Claude session that starts in this repo should read `docs/plans/plan-web-desktop-sharing.md` first. Update the **Phase Ledger** at the end of each session — never end without recording PR number, status, surprises, decisions.

## 2. One Claude session per PR

Don't try to ship multiple phases in a single Claude session. Each session = one phase = one PR. Reasons:

- Context window stays sharp.
- Failed PRs reset cleanly without polluting other phases.
- Plan-file diffs in each PR show what changed in the plan as work progressed.

End-of-session ritual:

1. Update the row for your phase in the ledger.
2. Add a "Notes" entry with anything non-obvious discovered (deviations, blockers, follow-ups).
3. Commit the plan update on the same PR.

## 3. Worktrees for parallel phases

For phases marked **parallel-safe** with each other (rows 1–6 in the cadence table), use git worktrees so two engineers (or two sessions) can work concurrently without checkout thrash. Worktrees also avoid rebuilding `llama.cpp` and re-running `mise install` per branch switch.

```bash
cd ~/jean/Seed/doc-web-editing
git worktree add ../wt-phase-0 -b refactor/phase-0-options-panel main
git worktree add ../wt-phase-2 -b refactor/phase-2-publish-flush main
git worktree add ../wt-phase-3 -b refactor/phase-3-canedit main
# ... per phase
```

One Claude session per worktree. Each session locked to its phase. Cross-contamination = zero.

For sequential phases inside a track (e.g. Track A: Phase 0 → Phase 2 → Phase 1 → Phase 7), reuse the same worktree, swap branches between PRs, start a fresh Claude session per PR.

## 4. Solo vs two-engineer mode

**Solo, no rush** → single worktree, sequential, fresh Claude session per PR. ~8 working days end-to-end.

**Solo, want parallelism** → 2 worktrees, 2 concurrent Claude sessions on different terminals. Track A handles infra (Phases 0, 2, 1, 7). Track B handles independent lifts (Phases 3, 4, 5, 6, 8).

**Two engineers** → worktree per engineer, session per engineer per PR. ~5 working days end-to-end.

## 5. Plan-update protocol

Each PR session ends with:

1. Update the phase row: status, PR number, owner, worktree, dates.
2. Append any deviations / surprises / followups discovered.
3. Commit the plan update on the same PR.

The next session reads the latest plan, knows what's done, what's pending, what changed.

## 6. Session kickoff template

Paste this at the start of any new Claude session in this repo to get oriented quickly:

```
Read docs/plans/plan-web-desktop-sharing.md. I'm picking up Phase <N>. The phase ledger is at the bottom — update my row when we start (mark in-progress, set worktree path) and when we finish (status, PR number, notes).

Stay scoped to Phase <N>. If I ask for unrelated work, push back and remind me to file a follow-up.
```
