# Draft context unification (Phase 2)

## Why

After "Phase 1 — desktop draft-aware breadcrumbs" shipped, the codebase has
three overlapping draft-related React contexts:

- `DraftActionsContext` (`frontend/packages/editor/src/draft-actions-context.tsx`)
  — editor surface: create / lookup / delete / open inline drafts.
- `DraftBreadcrumbContext` (`frontend/packages/shared/src/draft-breadcrumb-context.tsx`)
  — breadcrumb data lookup; added in Phase 1.
- `QueryBlockDraftsContext` (`frontend/packages/shared/src/query-block-drafts-context.tsx`)
  — UI-slot context for query blocks; a separate concern from the data
  contexts.

Two of these (Actions, Breadcrumb) overlap conceptually: both are
platform-specific draft data lookups consumed by shared UI. They should
collapse into a single provider per app, and the web app needs parity with
desktop so renamed drafts also win in the breadcrumb on web.

## Goal

- One unified `DraftContext` in `@shm/shared` covering both editor and
  breadcrumb use cases.
- Web provider with parity: IndexedDB-backed drafts; breadcrumbs and inline
  drafts both work; no daemon `Resource` fetches for draft segments.
- Keep `QueryBlockDraftsContext` separate for now (it is a UI-slot, not a
  data context). Flag as a possible later cleanup.

## Plan

1. Move `frontend/packages/editor/src/draft-actions-context.tsx` →
   `frontend/packages/shared/src/draft-context.tsx`. Leave a one-line
   re-export shim in the old path so existing editor imports keep
   compiling; migrate call-sites opportunistically.

2. Extend the moved type with `useDraftsForAccount` from Phase 1:

   ```ts
   export type DraftContextValue = {
     onCreateInlineDraft: (
       parentId: UnpackedHypermediaId,
     ) => Promise<{draftId: string; draftPath: string[]}>
     useInlineDraft: (id: string | undefined) => {data?: HMListedDraft | null}
     onDeleteDraft: (id: string) => Promise<void>
     onOpenDraft: (draftId: string, draftPath: string[]) => void
     useDraftsForAccount: (uid: string | undefined) => {
       data: HMListedDraftWithLocation[] | undefined
       isLoading: boolean
     }
   }
   ```

3. Delete `frontend/packages/shared/src/draft-breadcrumb-context.tsx`. Move
   `useDraftsForAccountSafe`, `findDraftForPath`, and the
   `HMListedDraftWithLocation` re-export next to the unified context.
   Update `frontend/packages/ui/src/resource-page-common.tsx` to consume the
   unified context instead of the Phase 1 breadcrumb-only one.

4. Desktop: fold `DesktopDraftBreadcrumbProvider` into
   `DesktopDraftActionsProvider` (rename to `DesktopDraftProvider`). The
   merged provider supplies the full `DraftContextValue`.

5. Web:
   - Add `listWebDocDraftsForAccount(uid)` and a
     `webDraftToListedDraft(d) → HMListedDraftWithLocation` mapper to
     `frontend/apps/web/app/document-edit/web-draft-db.ts`. Scan by
     `editUid === uid || locationUid === uid`. Cheap given web draft volume.
   - New `frontend/apps/web/app/web-draft-provider.tsx` fulfils the full
     `DraftContextValue`. React-query wrappers around the IndexedDB helpers;
     invalidate `['web-drafts-account', uid]` from every save site in
     `frontend/apps/web/app/document-edit/web-document-actors.ts`. If
     `onCreateInlineDraft` / `onDeleteDraft` / `onOpenDraft` are out of
     scope for web product yet, ship them as `console.warn` stubs. The
     breadcrumb features keep working since they only need
     `useDraftsForAccount` + `useInlineDraft`.

6. Mount `<WebDraftProvider>` around `<ResourcePage>` in
   `frontend/apps/web/app/web-resource-page.tsx`.

7. Keep `QueryBlockDraftsContext` separate. Note as a possible later
   cleanup.

## Verification

- All Phase 1 desktop verification steps still pass — see Phase 1 plan.
- Web: create a new child draft and rename a published doc in the draft
  editor. The breadcrumb renders the draft title in both cases without a
  `/Resource` request hitting the gateway.
- SSR HTML matches today's output (provider returns empty server-side, no
  draft override).
- Tests: `pnpm --filter @shm/web test` covers
  `listWebDocDraftsForAccount`; existing `findDraftForPath` tests in
  `@shm/shared` still pass after the move.
- Gates per `frontend/AGENTS.md`: `pnpm typecheck`, `pnpm test`,
  `pnpm audit`, `pnpm format:write`.

## Out of scope

- Folding `QueryBlockDraftsContext` into the unified data context.
- Server-side draft storage on web (the IndexedDB store stays
  per-browser).
- Cross-account draft breadcrumbs (current model assumes the entire
  breadcrumb chain is anchored to one root account).
