---
name: testing-desktop-seed
description: How to run and manually test the Seed desktop app in a headless VNC environment using fixture-mode data.
---

# Testing the Seed desktop app

Use this when you need end-to-end verification of desktop-only code paths (e.g. `frontend/apps/desktop/src/models/documents.ts`).

## Devin Secrets Needed

- None for fixture-mode smoke tests. The app creates a local `z6Mk...` identity in the fixture data dir.

## Launch

1. Make sure the repo tooling is installed (`mise`, `direnv`, `pnpm`).
2. Launch the desktop with a writable fixture directory so the daemon uses a file keystore instead of the D-Bus Secret Service:

   ```bash
   SEED_FIXTURE_DATA_DIR=/tmp/seed-fixture ./dev run-desktop
   ```

   The daemon will be spawned with `-keystore-dir=/tmp/seed-fixture/daemon/keys`.

3. Maximize the Electron window once it appears:

   ```bash
   wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
   ```

4. If a previous run is still running, kill `electron`, `seed-daemon`, and Vite dev-server processes first and clear the fixture dir to start clean:

   ```bash
   pkill -f electron
   pkill -f seed-daemon
   rm -rf /tmp/seed-fixture
   ```

## Account creation

In fixture mode the `useDesktopAuthDialog` / vault flow fails because the file keystore is not a `vault.Vault`. Use the local account creation path:

- `frontend/apps/desktop/src/components/create-account.tsx` exposes `useCreateAccountDialog()`.
- Click the top-right titlebar account icon and select **Create account** to open the local account dialog without an identity server.
- If the titlebar menu is not reachable (for example on the onboarding route), temporarily add a button that imports `useCreateAccountDialog` and calls `createAccountDialog.open({})`, then remove it before finishing.

## Common test workarounds

- The `Publish` and `Options` popover triggers in `frontend/packages/ui/src/editing-toolbar.tsx` may not open via mouse clicks in the VNC session (popover/focus timing). Add a temporary global keyboard shortcut (`Alt+Shift+E` for `send({type: 'edit.start'})`, `Alt+Shift+P` for `publishNow()`) inside `PublishButtonWithPopover` when you need to drive publish. Remove it before finishing.
- The `+` icon next to **Home** in the file browser may also be unresponsive. Use `File → New Document` (`Ctrl+Alt+N`) instead.
- `CreateSpaceForm` fields and buttons only respond to clicks near the center of the visible text; avoid clicking edges.

## Verify file-browser titles

The canonical E2E path:

1. Create a document with a title, publish, and confirm the title appears in the file browser.
2. Re-open it, edit the body without changing the title, publish again, and confirm the title still appears.
3. Create a new document with an empty title and confirm the file-browser row shows the slug (`untitled-<draftId>`), not "Untitled Document".

If step 3 shows a stale previous title instead, `draft.metadata` is leaking between drafts. Add temporary `console.log` instrumentation in `frontend/apps/desktop/src/models/documents.ts` around `usePublishResource` to inspect `draft.metadata`, `editDocument?.metadata`, and `expandedMetadata`.

## Teardown

- Stop the desktop app with `Ctrl+Q` or `pkill -f electron`.
- Remove `/tmp/seed-fixture` to reset.
