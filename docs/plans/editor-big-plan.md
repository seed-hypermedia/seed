# Unified Document Lifecycle State Machine

## Context

The current architecture splits document rendering into two completely separate paths:
- **Published documents**: `BlocksContent` (read-only React component, no state machine)
- **Drafts**: `draftMachine` (XState) + `BlockNoteEditor` (editable)
- **Publishing**: Ad-hoc mutation logic in `publish-draft-button.tsx`

The goal is to replace `BlocksContent` with the editor for both modes, using a unified state machine that manages the full document lifecycle. This enables:
- Single entry point for document rendering (editor in both readOnly and editable modes)
- Editor extensions loaded based on machine state
- Publishing as a first-class state transition
- SSR compatibility (machine alongside React Query)
- Proper version tracking (deps) for block references, copy link, and future rebase

---

## Full State Machine Design (target)

```
DocumentLifecycle
├── loading (initial)
│   → document.loaded → loaded
│   → document.error → error
│
├── loaded (read-only editor)
│   Features: copy block link, select text, supernumbers, block citations
│   Copy references use context.publishedVersion (never draft content)
│   → edit.start [guard: canEdit] → editing
│   → document.remoteUpdate → loaded (update document + publishedVersion)
│
├── editing (desktop only)
│   ├── idle (no unsaved changes)
│   │   → change → changed
│   │   → publish.start [guard: hasDraftId] → publishing
│   │
│   ├── changed (waiting for autosave, 500ms)
│   │   → after autosaveTimeout:
│   │     [hasDraftId] → saving
│   │     [else] → creating
│   │
│   ├── creating (first draft write)
│   │   invoke: writeDraft
│   │   onDone → idle (sets draftId, draftCreated)
│   │   onError → idle (status: error)
│   │
│   └── saving (subsequent draft writes)
│       invoke: writeDraft
│       onDone → idle (status: saved)
│       onError → idle (status: error)
│
│   → edit.cancel → loaded (clears draft state)
│   → change.navigation → saving/creating
│   → document.remoteUpdate → (stays in editing, updates pendingRemoteVersion)
│
├── publishing
│   ├── inProgress
│   │   invoke: publishDocument (uses context.deps as baseVersion)
│   │   onDone → cleaningUp
│   │   onError → editing.idle (toast error)
│   │
│   └── cleaningUp
│       entry: [notifyPublishSuccess, clearDraftState]
│       → loaded
│
└── error
    → document.loaded → loaded (retry)
```

---

## Key Design Decisions

### SSR: Machine alongside React Query
- React Query handles data fetching (existing 3-wave SSR prefetch stays)
- Machine manages UI/editor state only
- Component sends `document.loaded` when React Query data resolves
- On SSR: machine starts in `loading`, transitions to `loaded` during client hydration

### Click-to-edit: Draft created on first content change
- `edit.start` transitions to `editing.idle` (no draft yet)
- First real content change → `editing.changed` → autosave → `editing.creating` (draft created)
- Matches current behavior: draft isn't created until content actually changes

### Web = read-only
- Machine input includes `canEdit: boolean` (false on web)
- `canTransitionToEditing` guard blocks `edit.start` on web
- Web never needs `writeDraft` or `publishDocument` actors

### Publishing: high-level states
- `publishDocument` actor wraps the full pipeline (publish → auto-link parent → delete draft → navigate → push)
- Machine only tracks: inProgress / success / error
- Publish mutation logic stays in desktop app, provided via `.provide()`
- Uses `context.deps` as `baseVersion` for the publish RPC

### Version tracking and deps
- `publishedVersion`: Latest known published version (dot-separated CID string). Updated on `document.loaded` and `document.remoteUpdate`. Used for copy block link / copy block fragment — references always point to published versions, never draft content.
- `deps`: Array of CID strings the draft depends on. Set from `publishedVersion` when entering editing. This is the `baseVersion` sent to the publish RPC.
- `pendingRemoteVersion`: Set when a `document.remoteUpdate` arrives while in `editing` state. Content NOT auto-applied — user's draft changes preserved. Enables future "rebase" flow.
- **In `loaded` state**: `document.remoteUpdate` immediately updates document content and `publishedVersion`.
- **In `editing` state**: `document.remoteUpdate` only updates `pendingRemoteVersion`. UI indicator shows "new version available."

### External events (cross-component / cross-process)
- The machine actor ref can be sent events from any component that holds a reference to it via `actor.send({type: 'event'})`.
- Cross-process events (Electron main → renderer): Use existing tRPC subscription bridge. Main process events (like new version from network) already flow through React Query invalidation → refetch → component detects version change → sends `document.remoteUpdate` to machine. No direct main-to-machine bridge needed.
- Other components (e.g., sidebar, toolbar, publish button): Access the actor ref via React context. Any component in the tree can `send()` events to the machine.

### State persistence for fast navigation
- Use XState's `actor.getPersistedSnapshot()` to serialize state + context to JSON.
- Store in an in-memory Map keyed by document ID (survives tab switches, not app restarts).
- On return to a document: `createActor(machine, {snapshot: persisted})` — skips `loading`, restores the exact state (including `editing` with unsaved changes if applicable).
- React Query cache already preserves document data — combined with persisted machine state, navigation back is near-instant.

### Navigate to a document that has an existing draft
- When navigating to a **document route** (not a specific version), check if a draft exists for that document (via existing `findByEdit` query).
- If draft exists → instantiate machine with `existingDraftId` → after `document.loaded`, auto-transition to `editing` state with draft content loaded.
- If navigating to a **specific version** AND a draft exists → load the published version in `loaded` state. Future: show a modal ("You have a draft for this document. Open draft instead?").
- If no draft → normal `loaded` state.

---

## Types

```typescript
type DocumentMachineInput = {
  documentId: UnpackedHypermediaId
  canEdit: boolean
  existingDraftId?: string
  editUid?: string
  editPath?: string[]
  locationUid?: string
  locationPath?: string[]
  deps?: string[]
}

type DocumentMachineContext = {
  documentId: UnpackedHypermediaId
  draftId: string | null
  document: HMDocument | null
  metadata: HMDraft['metadata']
  deps: string[]                           // CIDs the draft depends on (baseVersion for publish)
  publishedVersion: string | null          // Latest known published version (dot-separated CIDs)
  pendingRemoteVersion: string | null      // New version received while editing (not yet applied)
  navigation: HMNavigationItem[] | undefined
  locationUid: string
  locationPath: string[]
  editUid: string
  editPath: string[]
  canEdit: boolean
  hasChangedWhileSaving: boolean
  draftCreated: boolean
  error: unknown
}

type DocumentMachineEvent =
  | { type: 'document.loaded'; document: HMDocument }
  | { type: 'document.error'; error: unknown }
  | { type: 'edit.start' }
  | { type: 'edit.cancel' }
  | { type: 'change'; metadata?: HMDraft['metadata'] }
  | { type: 'change.navigation'; navigation: HMNavigationItem[] }
  | { type: 'reset.content' }
  | { type: 'publish.start' }
  | { type: 'document.remoteUpdate'; document: HMDocument }
```

### Guards
- `canTransitionToEditing` — `context.canEdit`
- `didChangeWhileSaving` — `context.hasChangedWhileSaving`
- `hasDraftId` — `context.draftId !== null`
- `hasRemoteUpdate` — `context.pendingRemoteVersion !== null`

### Actors (provided via `.provide()`)
- `writeDraft: fromPromise<{id: string}, WriteDraftInput>` — persists draft
- `publishDocument: fromPromise<HMDocument, PublishInput>` — full publish pipeline

### Delays
- `autosaveTimeout: 500` (same as current)

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Navigate away with unsaved changes | External `setNavigationGuard` reads `state.matches('editing')` + `context.draftCreated` |
| Edit on web | `canTransitionToEditing` guard returns false; `edit.start` event is dropped |
| Publish fails | Transitions back to `editing.idle` with error toast; draft intact |
| Draft save fails | Transitions to `editing.idle` with `status: error`; next change retries |
| Remote update in `loaded` state | Updates document content + `publishedVersion` immediately |
| Remote update while editing | Sets `pendingRemoteVersion`; draft changes preserved; UI can show indicator |
| Copy block link while editing | Uses `context.publishedVersion` (published CIDs), never draft content |
| Publishing with pending remote version | `deps` reflects version editing started from; publish RPC handles merge |
| Resume existing draft | Pass `existingDraftId` in input; auto-transition `loaded` → `editing` after document loads |
| Navigate back to same document | Restore persisted snapshot via `getPersistedSnapshot()` — skips loading |
| Navigate to specific version with draft | Load published version in `loaded` state; future: modal to offer draft |
| External component sends event | Access actor ref via React context, call `actor.send()` directly |

---

## Version Tracking Flow

### How `document.remoteUpdate` is triggered
React Query's `useResource()` refetches when main process polls activity (3s) / discovery (20s) and broadcasts invalidations. Component compares new version with `context.publishedVersion`. If different → sends `document.remoteUpdate`.

### Copy block link / fragment
Always reads `context.publishedVersion` to build the URL:
```
hm://uid/path?v={publishedVersion}#blockId
```
References always point to published, immutable content — never draft content.

### Publishing
Uses `context.deps` as `baseVersion`. Backend's `PrepareDocumentChange` RPC handles DAG ordering and conflict resolution.

### Future: Rebase (out of scope, but context fields support it)
`rebase.start` → diff `deps` vs `pendingRemoteVersion` → apply remote changes → update `deps` → clear `pendingRemoteVersion` → mark changed.

---

## Stately Studio Visualization

Machine is fully compatible with [Stately Studio](https://stately.ai/editor):
1. Paste machine definition into stately.ai/editor (supports XState v5)
2. Or use the [Stately VSCode extension](https://marketplace.visualstudio.com/items?itemName=statelyai.stately-vscode)
3. For live inspection: `@stately-ai/inspect` provides browser inspector

---

## Reusable existing code   
- `frontend/apps/desktop/src/draft-status.tsx` — `DraftStatus` type + `dispatchDraftStatus`
- `frontend/apps/desktop/src/models/documents.ts:611-652` — `writeDraft` actor pattern
- `frontend/apps/desktop/src/models/documents.ts:245-340` — `usePublishResource` mutation
- `frontend/packages/shared/src/constants.ts:64-72` — `IS_DESKTOP` / `IS_WEB`

---

# Implementation Phases

Each phase is a **standalone PR** with its own verification. Nothing breaks between phases — the old code keeps working until explicitly replaced. Each phase builds on the previous one but can be paused/reviewed independently.

---

## Phase 1: Machine definition only (no integration)

**Goal**: Create the state machine file with types, guards, and action stubs. Zero impact on existing code.

**What to do**:
- Create `frontend/packages/shared/src/models/document-machine.ts`
  - Machine with states: `loading`, `loaded`, `editing` (idle/changed/creating/saving), `publishing` (inProgress/cleaningUp), `error`
  - All types exported (Input, Context, Events)
  - Guards: `canTransitionToEditing`, `didChangeWhileSaving`, `hasDraftId`, `hasRemoteUpdate`
  - Action stubs (no-op implementations, provided later via `.provide()`)
  - Actors: `writeDraft` and `publishDocument` as placeholder `fromPromise` (throw "must be provided")
  - `autosaveTimeout: 500` delay

**What NOT to do**: No React hooks, no integration, no UI changes.

**Verify**:
- [ ] `pnpm -C frontend typecheck` passes
- [ ] Paste machine into Stately Studio — all states/transitions render correctly
- [ ] Unit tests for state transitions (send events, assert state matches)
  - `loading → document.loaded → loaded`
  - `loaded → edit.start (canEdit=true) → editing.idle`
  - `loaded → edit.start (canEdit=false) → stays loaded`
  - `editing.idle → change → editing.changed`
  - `editing.changed → (autosave) → editing.creating`
  - `editing.creating → writeDraft.done → editing.idle`
  - `editing → edit.cancel → loaded`
  - `editing.idle → publish.start → publishing.inProgress`
  - `publishing.inProgress → publishDocument.done → publishing.cleaningUp → loaded`
  - `document.remoteUpdate in loaded → updates publishedVersion`
  - `document.remoteUpdate in editing → updates pendingRemoteVersion only`

---

## Phase 2: React hook + selectors (no integration)

**Goal**: Create the React hook that wraps `useMachine`. Still no integration with existing pages.

**What to do**:
- Create `frontend/packages/shared/src/models/use-document-machine.ts`
  - `useDocumentMachine(input, providedActors)` hook
  - Convenience selectors: `isLoading`, `isLoaded`, `isEditing`, `isPublishing`, `canEdit`, `publishedVersion`, `pendingRemoteVersion`, `draftId`, `hasUnsavedChanges`
  - Type-safe `send()` wrapper

**What NOT to do**: No page changes, no imports from desktop/web apps.

**Verify**:
- [ ] `pnpm -C frontend typecheck` passes
- [ ] Hook types are correct (check manually or write a simple test component)

---

## Phase 3: Wire machine into desktop document page (loaded state only)

**Goal**: Use the machine in `desktop-resource.tsx` for the **read-only `loaded` state only**. No editing, no publishing through the machine yet. Existing edit/publish flows continue working as before.

**What to do**:
- In `desktop-resource.tsx`: instantiate machine with `canEdit: true`
- Send `document.loaded` when `useResource()` data arrives
- Send `document.remoteUpdate` when version changes
- Read `context.publishedVersion` for copy block link (replace current version source)
- Provide actor ref via React context so external components can send events
- Implement snapshot persistence: save `actor.getPersistedSnapshot()` to in-memory Map on unmount, restore on mount if available for same document ID
- Keep all existing edit button / navigate-to-draft / publish button as-is

**What NOT to do**: Don't touch editing or publishing flows. Don't remove `BlocksContent`. Don't touch draft page.

**Verify**:
- [ ] `pnpm -C frontend typecheck` passes
- [ ] Open a published document → machine is in `loaded` state (check via Stately inspector or console log)
- [ ] Copy block link → URL contains correct published version
- [ ] Remote update arrives → `publishedVersion` updates, copy link reflects new version
- [ ] Navigate away and back → machine restores from snapshot (no loading flash)
- [ ] Existing edit button still works (navigates to draft page as before)
- [ ] Existing publish flow still works

---

## Phase 4: Wire machine into web document page (loaded state only)

**Goal**: Same as Phase 3 but for the web app. Machine with `canEdit: false`.

**What to do**:
- In `web-resource-page.tsx`: instantiate machine with `canEdit: false`
- Send `document.loaded` when React Query data resolves (post-hydration)
- Send `document.remoteUpdate` on version changes
- Read `context.publishedVersion` for any block reference features

**What NOT to do**: No editing, no publishing (web doesn't have these).

**Verify**:
- [ ] `pnpm -C frontend typecheck` passes
- [ ] SSR still works (server renders, client hydrates without errors)
- [ ] Open published document on web → machine is in `loaded` state
- [ ] No `edit.start` capability (guard blocks it)

---

## Phase 5: Add editing states to desktop (replace draft machine)

**Goal**: Enable `edit.start` transition on desktop. When user clicks to edit, machine transitions to `editing`. Provide `writeDraft` actor. This replaces the current draft page + draft machine.

**What to do**:
- Implement `edit.start` handler in desktop-resource page: make editor editable, focus
- Provide `writeDraft` actor (extract from `documents.ts:611-652`)
- Provide `edit.cancel` handler (make editor read-only again, clear draft state)
- Wire `onEditorContentChange` → `send({type: 'change'})` (only on `docChanged=true`, already handled by Tiptap)
- Wire `onTextCursorPositionChange` → no event sent (existing behavior)
- Wire `change.navigation` events
- Handle navigation guard using `state.matches('editing')` + `context.draftCreated`
- Set `deps` from `publishedVersion` on `edit.start` entry
- **Draft detection on navigate**: When navigating to a document route, query `findByEdit` to check for existing draft. If found, pass `existingDraftId` → machine auto-transitions to `editing` after loading.
- **Specific version + draft**: When navigating to a specific version (not latest), load in `loaded` state even if draft exists. (Future: show modal offering to open draft instead.)

**What NOT to do**: Don't touch publishing yet. Don't remove old draft page yet (keep as fallback).

**Verify**:
- [ ] `pnpm -C frontend typecheck` passes
- [ ] Open published doc → click to edit → machine transitions to `editing.idle`
- [ ] Type content → `editing.changed` → autosave → `editing.creating` (first time) or `editing.saving`
- [ ] Draft is created only after real content change (not on click-to-edit alone)
- [ ] Cursor/selection moves do NOT trigger draft creation
- [ ] `edit.cancel` → returns to `loaded` state
- [ ] Navigation guard prompts when leaving with unsaved changes
- [ ] Navigate to document with existing draft → auto-enters editing with draft content
- [ ] Navigate to specific version of document with draft → stays in loaded (published view)
- [ ] Old draft page still works (for existing drafts)

---

## Phase 6: Add publishing states to desktop

**Goal**: Move publish flow into the machine. Provide `publishDocument` actor.

**What to do**:
- Extract publish pipeline from `publish-draft-button.tsx` into a `publishDocument` actor function
- Provide actor via `.provide()` in desktop-resource page
- `publish.start` event triggers `publishing.inProgress` → invokes actor
- On success: `cleaningUp` → `loaded` (draft deleted, navigated, pushed)
- On error: back to `editing.idle` with toast
- Update publish button UI to read machine state and send `publish.start`
- `context.deps` used as `baseVersion` in the actor

**What NOT to do**: Don't remove old draft page yet.

**Verify**:
- [ ] `pnpm -C frontend typecheck` passes
- [ ] Full flow: view doc → edit → change → save → publish → back to loaded
- [ ] Publish error → returns to editing, draft intact
- [ ] Parent auto-link works
- [ ] Push to peers works (background)
- [ ] `pendingRemoteVersion` is preserved through editing → publish uses correct deps

---

## Phase 7: Migrate existing drafts and remove old code

**Goal**: Handle existing drafts via the unified machine. Remove old draft page and draft machine.

**What to do**:
- When navigating to an existing draft: instantiate machine with `existingDraftId`, auto-transition through `loaded` → `editing`
- Redirect old draft routes to document routes with editing state
- Remove `frontend/apps/desktop/src/models/draft-machine.ts`
- Remove draft page (`draft.tsx`) or redirect to resource page
- Clean up `useDraftEditor` in `documents.ts`

**What NOT to do**: Don't remove `BlocksContent` yet (Phase 8+).

**Verify**:
- [ ] `pnpm -C frontend typecheck` passes
- [ ] Existing drafts open correctly via unified machine
- [ ] Creating a new document → editing state works
- [ ] No references to old draft machine remain
- [ ] All existing tests pass

---

## Phase 8+ (future): Replace BlocksContent with editor

**Goal**: Use the editor in read-only mode instead of `BlocksContent`. Separate effort with its own phases.

- Replace `BlocksContent` rendering with editor (`editable: false`) in `loaded` state
- Implement document-viewing extensions (block hover, supernumbers, etc.)
- Remove `blocks-content.tsx`
- This is the original "editor extensions" migration work
