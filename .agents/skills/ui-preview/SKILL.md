---
name: ui-preview
description:
  Show how a frontend UI change looks before it ships. Renders real @shm/ui components with fixture data and the real
  theme CSS in light and dark mode, and screenshots them; optionally runs the full web app against a local daemon. Use
  after any visual change in frontend/packages/ui (or desktop/web UI built on it), whenever the user asks to see the
  change, and in cloud sessions where the full app cannot sync real content.
---

# UI preview

Default to showing every visual change: after editing UI, produce a light + dark screenshot of the real component and
send it to the user. Say plainly that the data is fixture data, not their real site.

## 1. Install dependencies

```sh
pnpm install --frozen-lockfile
```

In Claude Code cloud sessions this can fail with `ERR_PNPM_FETCH_403` on `codeload.github.com/electron/node-gyp/...`.
The session's GitHub proxy only serves tarballs of repositories attached to the session, and `electron/node-gyp` (a
transitive Electron dependency) is not one. Workaround, **only with the user's explicit approval** because it
temporarily edits the lockfile:

1. Back up `pnpm-lock.yaml` to the scratchpad.
2. Build the tarball from git (git reads of public repos are allowed):
   `git init -q ng && git -C ng fetch -q --depth 1 https://github.com/electron/node-gyp <commit>` then
   `git -C ng archive --prefix=package/ -o node-gyp.tgz FETCH_HEAD`, using the commit from the failing URL.
3. Point only that `resolution: {tarball: ...}` line in `pnpm-lock.yaml` at `file:<abs path>/node-gyp.tgz`.
4. Run `pnpm install --frozen-lockfile`, then restore the backed-up lockfile and confirm `git status` shows no lockfile
   change.

## 2. Preview a component (fast path, no daemon)

The harness in `harness/` is a Vite app that imports `@shm/ui`, `@shm/shared` and `@seed-hypermedia/client` straight
from source and compiles `theme.css` + `base.css` with Tailwind, exactly like the apps do. Data hooks are replaced with
fixtures through module aliases, so the component code itself is untouched.

Per task, create these gitignored files in `harness/`:

- `preview.local.tsx` exporting `Preview`, the component(s) to render with fixed props. The harness renders it twice,
  once in light and once in dark mode.
- `aliases.local.json` mapping module ids to fixture files, e.g.
  `{"@shm/shared/models/entity": "./fixture-entity.local.ts"}`. Find which hooks a component calls and fake only those;
  mirror the shapes its unit test mocks use (`frontend/packages/ui/src/__tests__/`).
- Fixture modules (`*.local.ts`) exporting the replaced hooks with data covering every visual state that matters
  (active, hover-free default, empty, private, draft, nested...).

`examples/site-file-browser/` is a complete working example: copy its files into `harness/` to try the setup.

Run from the repo root:

```sh
node_modules/.bin/vite --config .agents/skills/ui-preview/harness/vite.config.mjs   # background; serves :5199
CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
  node .agents/skills/ui-preview/harness/screenshot.mjs http://localhost:5199/ <scratchpad>/preview.png
```

`CHROMIUM_PATH` is needed when the browser preinstalled in the environment differs from the repo's Playwright version;
leave it unset locally if Playwright's own browser is installed. Read the screenshot yourself before sending it, and fix
any `pageerror` output first (usually a hook that still needs a fixture). To show before/after, screenshot on the base
branch and on the change.

Clean up: stop Vite and delete the `*.local.*` files.

## 3. Full web app (slower, real app shell)

Use when the change depends on page layout or data flow, not just one component.

1. Daemon prerequisites: `git submodule update --init --recursive --depth 1`, download the embedding model and build
   llama.cpp as the `ensure-model` and `ensure-llama-libs` tasks in `mise.toml` do (Linux: CPU-only `CMAKE_ARGS`).
2. Build the daemon where the integration tests expect it:
   ```sh
   L=$PWD/backend/util/llama-go
   CGO_ENABLED=1 CGO_CXXFLAGS=-std=c++17 LIBRARY_PATH=$L C_INCLUDE_PATH=$L \
     go build -tags cpu -trimpath -buildvcs=false -o plz-out/bin/backend/seed-daemon-x86_64-unknown-linux-gnu ./backend/cmd/seed-daemon
   ```
   Containers without an OS keyring need `-keystore-dir <dir>` when starting the daemon by hand.
3. Seed local fixture content and serve the web app: `bun tests/integration/seed-collection-ui.ts` (see the
   `testing-seed-web` skill). Cloud sessions cannot reach the P2P network, so real sites will not sync; use fixture
   content created locally, not content copied from someone's live site.
4. Screenshot pages with `screenshot.mjs`.
