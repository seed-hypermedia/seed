# unified-document-lifecycle-machine — DONE

## Completed

- [x] Document state machine (`document-machine.ts`)
- [x] React bindings (`use-document-machine.ts`)
- [x] Wired `DocumentMachineProvider` into `resource-page-common.tsx`
- [x] Desktop passes `canEdit` prop
- [x] Web defaults to `canEdit: false`
- [x] Re-exports from `@shm/shared/index.ts`
- [x] `pnpm typecheck` passes

---

# Follow-ups from the `simplify-editor-dom` / natural-typography PR

Parked work that deliberately stayed out of that PR so it landed small. Pick them up in order; each is its own branch.

## 1. Remove the desktop draft page (own PR)

**Why:** `apps/desktop/src/pages/draft.tsx` duplicates document-editor wiring that now lives in `pages/desktop-resource.tsx`. The two paths drifted (e.g. the draft page's `HyperMediaEditorView` missed the `.hm-prose` class until we patched it), and the draft route is already functionally a "document with a pending draft." Deleting it unifies the lifecycle and eliminates the class of bug where a fix has to be applied in two places.

**Scope (rough order):**

- [ ] Decide how draft-specific route fields (`editUid`, `editPath`, `locationUid`, `locationPath`, `selection`) carry into `DocumentRoute`: extend `DocumentRoute` or add an optional `draft` sub-shape.
- [ ] Update `@shm/shared/routes` to reflect the chosen shape; mark `DraftRoute` deprecated (or remove after all callers are migrated).
- [ ] Rewrite `apps/desktop/src/utils/publish-utils.ts::computeDraftRoute` to return a `DocumentRoute` with draft fields populated.
- [ ] Update `apps/desktop/src/utils/__tests__/publish-utils.test.ts` accordingly.
- [ ] Walk every `route.key === 'draft'` callsite and rewrite against the new fields:
  - `apps/desktop/src/components/titlebar-common.tsx` (≈20 refs — publish button, edit state, breadcrumbs).
  - `apps/desktop/src/components/publish-draft-button.tsx`.
  - `apps/desktop/src/components/assistant-panel.tsx`.
  - `apps/desktop/src/hooks/route-breadcrumbs.ts`.
  - `apps/desktop/src/app-api.ts`.
  - `apps/desktop/src/models/documents.ts`.
  - `apps/desktop/src/pages/__tests__/accessory-shortcuts.test.ts`.
  - `apps/desktop/src/components/__tests__/omnibar.test.ts`.
- [ ] Extend `pages/desktop-resource.tsx`'s `supportedKeys` if the draft route is absorbed; otherwise remove the `case 'draft'` branch in `pages/main.tsx`.
- [ ] Delete `apps/desktop/src/pages/draft.tsx` (≈1200 LoC).
- [ ] `pnpm typecheck` + `pnpm test` + smoke-test the import / paste / new-draft flows.

**Estimate:** ~2–3 focused hours + manual smoke test.

## 2. Try to really fix the xmldom high-severity CVEs (own PR)

**Why:** The latest commit on `simplify-editor-dom` (`713dab681`) adds 4 new xmldom CVEs to `pnpm-workspace.yaml`'s `auditConfig.ignoreCves` list. That unblocks CI but the `xmldom < 0.8.13` chain still sits in `node_modules`. The ignore list is already 7 entries long; each added ignore erodes the signal.

The advisories don't reach runtime code — `xmldom` is pulled in via `@electron-forge/cli → @electron/packager → plist` (a packaging-time devDep parsing our own Info.plist / entitlements), so exploitation requires attacker-controlled XML we never hand it. Still, we should stop adding ignores.

**Try, in order:**

1. [ ] **pnpm override to 0.8.13.** The old pnpm-workspace comment warns "0.9.x breaks plist" — but 0.8.13 is a patch on the same minor. Likely safe.
   ```yaml
   # pnpm-workspace.yaml
   overrides:
     '@xmldom/xmldom': '^0.8.13'
   ```
   Run `pnpm install`, then `pnpm --filter desktop make` and package for **macOS .dmg**, **Windows .exe**, **Linux .AppImage**. Launch each. If all pass:
   - [ ] Remove every xmldom CVE from `auditConfig.ignoreCves` (CVE-2026-34601, 41672, 41673, 41674, 41675).
   - [ ] Delete the xmldom ignore comment in `pnpm-workspace.yaml`.
2. [ ] **If 0.8.13 also breaks plist:** upgrade `@electron-forge/cli` + `@electron/packager` to the newest versions (packager ≥ 18.4 moved plist to xmldom 0.9.x). Electron-forge major bumps are usually accompanied by breaking config changes — budget ~half a day of CI + packaging regression testing.
3. [ ] **If both 1 and 2 fail:** file an upstream issue on `@electron/packager` (or `plist`) to unpin xmldom, and add a TODO in pnpm-workspace.yaml linking that issue so we can re-evaluate when it's resolved.

**Also consider, while we're there:**

- [ ] Revisit the `electron < 39.8.5` CVE cluster already in the ignore list (CVE-2026-34769/70/71/74). We're on Electron 35; 39 is a major jump. Schedule an Electron upgrade spike — even a dry run behind a feature flag — and file whatever regressions surface. Electron 36/37/38/39 each had real security fixes beyond these four.
- [ ] Revisit `ip < 2.0.2` (SSRF, no patch) — reaches us via `lighthouse > puppeteer-core` and `react-devtools`. Both are devDeps only. Track whether upstream publishes a fix, or swap `react-devtools` for the browser-extension equivalent so we stop shipping it as a dep.

**Estimate:** 30 min if option 1 works; half a day if option 2 is needed; no-go otherwise.
