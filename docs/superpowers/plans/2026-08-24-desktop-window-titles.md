# Desktop Window Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make each desktop window's native title identify its current page, using \`<document name> – <view name>\` for dedicated document-view routes while ignoring right-side panels.

**Architecture:** Add a pure title formatter beside the existing route breadcrumb utilities, then mount one renderer component at the desktop page shell that resolves the active resource name and assigns the result to \`document.title\`. Electron propagates the renderer title to the native \`BrowserWindow\`, so no preload, IPC, or main-process change is needed.

**Tech Stack:** Electron 39, React 18, TypeScript, TanStack Query resource hooks, Vitest.

---

## File structure

- Modify \`frontend/apps/desktop/src/hooks/route-breadcrumbs.ts\` to format native titles from the complete active route.
- Modify \`frontend/apps/desktop/src/hooks/__tests__/use-route-breadcrumbs.test.ts\` to specify title formatting.
- Create \`frontend/apps/desktop/src/components/window-title.tsx\` to resolve the active name and synchronize \`document.title\`.
- Create \`frontend/apps/desktop/src/components/__tests__/window-title.test.tsx\` to verify renderer synchronization.
- Modify \`frontend/apps/desktop/src/pages/main.tsx\` to mount the synchronizer once per window.

No main-process, preload, route-schema, or custom title-bar changes are required.

### Task 1: Specify and implement route title formatting

**Files:**
- Modify: \`frontend/apps/desktop/src/hooks/route-breadcrumbs.ts:75-101\`
- Test: \`frontend/apps/desktop/src/hooks/__tests__/use-route-breadcrumbs.test.ts:44-82\`

- [ ] **Step 1: Write failing formatter tests**

Change \`getWindowTitle\` tests to pass a complete \`NavRoute\`. Cover:

\`\`\`ts
expect(getWindowTitle({key: 'contacts'})).toBe('Contacts')
expect(getWindowTitle({key: 'settings'})).toBe('Settings')
expect(getWindowTitle({key: 'document', id}, 'Document A')).toBe('Document A')
expect(getWindowTitle({key: 'activity', id}, 'Document A')).toBe('Document A – Activity')
expect(
  getWindowTitle(
    {key: 'activity', id, filterEventType: activitySlugToFilter('citations')},
    'Document A',
  ),
).toBe('Document A – Citations')
expect(getWindowTitle({key: 'comments', id}, 'Document A')).toBe('Document A – Discussions')
expect(getWindowTitle({key: 'directory', id}, 'Document A')).toBe('Document A – Sub-documents')
expect(getWindowTitle({key: 'collaborators', id}, 'Document A')).toBe('Document A – Collaborators')
expect(getWindowTitle({key: 'metadata', id}, 'Document A')).toBe('Document A – Metadata')
expect(
  getWindowTitle({key: 'document', id, panel: {key: 'comments'}}, 'Document A'),
).toBe('Document A')
expect(getWindowTitle({key: 'document', id})).toBe('Seed')
\`\`\`

Use \`activitySlugToFilter('citations')\` rather than hard-coding daemon event strings.

- [ ] **Step 2: Run the focused test and verify it fails**

\`\`\`bash
direnv exec . pnpm --dir frontend/apps/desktop exec vitest run src/hooks/__tests__/use-route-breadcrumbs.test.ts
\`\`\`

Expected: FAIL because \`getWindowTitle\` still accepts a route key and does not add view suffixes.

- [ ] **Step 3: Implement the minimal formatter**

Change the signature to:

\`\`\`ts
export function getWindowTitle(route: NavRoute, activeName?: string): string
\`\`\`

Add a static title map for non-resource pages:

\`\`\`ts
const STATIC_WINDOW_TITLES: Partial<Record<NavRoute['key'], string>> = {
  onboarding: 'Welcome to Seed Hypermedia',
  contacts: 'Contacts',
  settings: 'Settings',
  'account-settings': 'Identity Settings',
  'site-settings': 'Site Settings',
  'deleted-content': 'Deleted Content',
  'api-inspector': 'API Inspector',
  'query-documents': 'Query Documents',
  explore: 'Explore',
  agents: 'Agents',
  'agent-server': 'Agents',
  'agent-session': 'Agent Session',
  notifications: 'Notifications',
  'site-settings-emails': 'Email Settings',
}
\`\`\`

For resource-backed routes, return the active name alone for \`document\`, \`contact\`, \`profile\`, and other base pages. Append an en-dash suffix only for dedicated route keys:

- \`activity\` → \`Activity\`, except its citations filter → \`Citations\`
- \`comments\` → \`Discussions\`
- \`directory\` and \`all-documents\` → \`Sub-documents\`
- \`collaborators\` → \`Collaborators\`
- \`metadata\` → \`Metadata\`
- \`inspect\` → \`Inspector\`
- \`feed\` → \`Feed\`

Return \`Seed\` while a resource-backed title is unavailable. Do not read \`route.panel\`.

- [ ] **Step 4: Run the formatter tests**

\`\`\`bash
direnv exec . pnpm --dir frontend/apps/desktop exec vitest run src/hooks/__tests__/use-route-breadcrumbs.test.ts
\`\`\`

Expected: PASS.

### Task 2: Synchronize the renderer title

**Files:**
- Create: \`frontend/apps/desktop/src/components/window-title.tsx\`
- Create: \`frontend/apps/desktop/src/components/__tests__/window-title.test.tsx\`
- Modify: \`frontend/apps/desktop/src/pages/main.tsx:180-210\`

- [ ] **Step 1: Write failing component tests**

Mock \`useNavRoute\` and \`useResource\`, render \`<WindowTitle />\`, and assert:

\`\`\`tsx
expect(document.title).toBe('Document A')
// Change the mocked route to the dedicated citations route and rerender.
expect(document.title).toBe('Document A – Citations')
// Change back to document + a comments panel and rerender.
expect(document.title).toBe('Document A')
\`\`\`

Add a second test where the resource initially has no name, expecting \`Seed\`, then resolves to \`Document A\` after rerender.

- [ ] **Step 2: Run the component test and verify it fails**

\`\`\`bash
direnv exec . pnpm --dir frontend/apps/desktop exec vitest run src/components/__tests__/window-title.test.tsx
\`\`\`

Expected: FAIL because \`WindowTitle\` does not exist.

- [ ] **Step 3: Implement \`WindowTitle\`**

Use \`useNavRoute()\` for the current route, narrow resource-backed routes to an \`UnpackedHypermediaId\`, and call \`useResource(id)\`. Derive the name with \`getDocumentTitle(resource.data.document)\` when the result is a document. Then synchronize it:

\`\`\`tsx
/** Synchronizes the current desktop page name to Electron's native window title. */
export function WindowTitle() {
  const route = useNavRoute()
  const resource = useResource(getRouteResourceId(route))
  const activeName =
    resource.data?.type === 'document'
      ? getDocumentTitle(resource.data.document) || undefined
      : undefined
  const title = getWindowTitle(route, activeName)

  useEffect(() => {
    document.title = title
  }, [title])

  return null
}
\`\`\`

Keep the component renderer-only. Do not add IPC or a \`page-title-updated\` listener.

- [ ] **Step 4: Mount the synchronizer once in the app shell**

Import \`WindowTitle\` in \`frontend/apps/desktop/src/pages/main.tsx\` and render it once in each top-level window tree. Include early-return window types such as Settings and the IPFS inspector, but do not mount it inside individual pages.

- [ ] **Step 5: Run both focused test files**

\`\`\`bash
direnv exec . pnpm --dir frontend/apps/desktop exec vitest run \
  src/hooks/__tests__/use-route-breadcrumbs.test.ts \
  src/components/__tests__/window-title.test.tsx
\`\`\`

Expected: both files PASS.

### Task 3: Verify the complete change

**Files:**
- Verify all files listed above.

- [ ] **Step 1: Format and check the entire frontend workspace**

\`\`\`bash
direnv exec . pnpm --dir frontend -r format:write
direnv exec . pnpm --dir frontend -r format:check
\`\`\`

Expected: tracked source files pass. Confirm any reported generated artifact with \`git check-ignore <path>\`.

- [ ] **Step 2: Typecheck and run desktop unit tests**

\`\`\`bash
direnv exec . pnpm --dir frontend/apps/desktop typecheck
direnv exec . pnpm --dir frontend/apps/desktop test:unit
\`\`\`

Expected: both commands PASS.

- [ ] **Step 3: Run the frontend audit**

\`\`\`bash
direnv exec . pnpm --dir frontend audit
\`\`\`

Expected: PASS under the workspace audit policy.

- [ ] **Step 4: Manually smoke-test using Jean's run environment**

Call Jean MCP \`get_run_environments\` for this worktree first. Reuse its URL, port, and startup command; do not guess a port or start a duplicate server.

1. Open Document A and Document B in separate windows.
2. Minimize both and confirm macOS labels them \`Document A\` and \`Document B\`.
3. Navigate Document A to its dedicated Citations route and confirm \`Document A – Citations\`.
4. Return to Document A, open the Comments right panel, and confirm the label remains \`Document A\`.
5. Navigate to Contacts and Settings and confirm \`Contacts\` and \`Settings\`.
6. Use Back and Forward and confirm the native label follows the active history entry.

- [ ] **Step 5: Review the diff without writing git state**

\`\`\`bash
git diff --check
git diff -- frontend/apps/desktop/src/hooks/route-breadcrumbs.ts \
  frontend/apps/desktop/src/hooks/__tests__/use-route-breadcrumbs.test.ts \
  frontend/apps/desktop/src/components/window-title.tsx \
  frontend/apps/desktop/src/components/__tests__/window-title.test.tsx \
  frontend/apps/desktop/src/pages/main.tsx
\`\`\`

Expected: no whitespace errors, no panel-derived suffixes, and no IPC/main-process changes. Do not commit unless the user explicitly requests it, per repository policy.
