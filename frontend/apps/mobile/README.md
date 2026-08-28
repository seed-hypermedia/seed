# Seed Mobile App

Expo-based React Native app for iOS, Android, and Web.

## Monorepo Setup Notes

This app lives in the repo but **outside the pnpm workspace** (it is excluded in `pnpm-workspace.yaml`). The root pnpm
workspace pins React 18 via `pnpm.overrides`, while React Native 0.81 / Expo 54 require React 19, so the app manages its
own dependencies with **npm**:

```bash
cd frontend/apps/mobile && npm install
# or from the repo root:
pnpm mobile:install
```

### The in-repo client package

The app talks to hypermedia servers through `@seed-hypermedia/client` (`frontend/packages/client`). It is not declared
as an npm dependency — instead it is aliased to the package sources:

- **metro.config.js** — `resolver.extraNodeModules` maps `@seed-hypermedia/client` to `frontend/packages/client`
- **tsconfig.json** — `paths` maps the same for typechecking
- **jest.config.js** — `moduleNameMapper` maps the same for tests

The client package's own dependencies (zod, cborg, ...) resolve from the root `node_modules`, so run `pnpm install` at
the repo root first.

### Key Configuration Files

**metro.config.js**

- `watchFolders` lists the specific in-repo packages the app resolves from — deliberately **not** the monorepo root.
  Watching the root means watchman crawls ~1.17M files (nested `node_modules`, `plz-out`, testdata, `.git`), which is
  enough to crash it on startup; because Metro respawns it, that becomes a crash loop that can take the machine down.
  Adding a new cross-package import means adding its directory to the list.
- `nodeModulesPaths`: app `node_modules` first, then the monorepo root
- `resolveRequest` forces a single copy of `react`, `react-dom` and `@tanstack/react-query` (the app's own). This has to
  be `resolveRequest`, not `extraNodeModules`: the latter is only a fallback for requests that fail normal resolution,
  and an import of `react` from `frontend/packages/*` resolves on its own by walking up to the root, which pins
  React 18. A shared module's hooks would then run against a second React whose dispatcher is null.
- `resolveRequest` also maps `@shm/ui/agents/*` to the shared agents sources, scoped to `.ts` files only so an
  accidental import of a web component fails at bundle time instead of pulling Radix into the native bundle.

**babel.config.js** — dual-mode: standard babel presets for Jest (`NODE_ENV=test`), `babel-preset-expo` for Expo/Metro
bundling.

**jest.config.js / jest.setup.js** — jsdom environment; native-only modules (react-native-mmkv, expo-crypto,
expo-secure-store) and the seed client are mocked. The real client is exercised by the e2e tests.

### Storage

`src/store/storage.ts` uses MMKV on native and localStorage on web — react-native-mmkv v4 is a Nitro native module and
cannot load on web/jsdom.

### Commands

```bash
# From the repo root
pnpm mobile            # Expo dev server (QR for device, press w for web)
pnpm mobile:web        # web only
pnpm mobile:test       # jest unit tests
pnpm mobile:typecheck  # tsc

# Native projects (from frontend/apps/mobile)
npx expo prebuild        # generates ios/ and android/
npx expo run:ios         # iOS simulator (after prebuild + pod install)
npx expo run:android     # Android emulator
```

### E2E tests

`tests/mobile-web.integration.test.ts` drives the web build of this app with Playwright against a real local stack
(seed-daemon + web app serving `/api`). From `tests/`:

```bash
npx vitest --run mobile-web.integration.test.ts
# SKIP_BUILD=true to reuse an existing web app build
```

Related: `tests/key-derivation.test.ts` (JS/Go key-derivation parity) and `tests/register-key.integration.test.ts`
(daemon registerKey against the same deterministic mnemonic).

### Known Issues

- Metro validation warnings about `watcher.unstable_*` options can be ignored
- expo-secure-store only works on native (the e2e tests do not press "Save")

## Agents

The agents screens (`src/agents/`) are the mobile port of the Seed Agents runtime — see `agents/docs/` for the system
itself. The platform-neutral half of the shared implementation is reused as-is from `@shm/ui/agents`: the signed client,
the React Query models, the chat row model and the tool summaries. Only the views are rewritten for React Native.

### Developing against a mock agent server

Talking to a real agent server needs a configured model provider and spends real tokens, and the interesting states — a
reply streaming in, a tool call sitting pending, a checklist advancing, a run parked waiting for you — are hard to
trigger on demand. `dev/mock-agents-server.ts` speaks the real protocol (signed DAG-CBOR actions and the WebSocket
subscription protocol) with scripted, deterministic responses:

```bash
npm run mock-agents          # serves http://localhost:3052
```

Then point the app's agent server at `http://localhost:3052` (Agents → Agent server → Change) and try:

| message                    | what it demonstrates                                       |
| -------------------------- | ---------------------------------------------------------- |
| _anything_                 | a reply streaming in token by token, rendered as markdown  |
| `read that document`       | a tool call rendering pending, then resolving with a title |
| `plan the summary`         | a live checklist, including a runtime-settled `AUTO` step  |
| `ask me before continuing` | a parked run with an **Answer** button                     |

The mock does **not** verify signatures — it trusts whatever account an envelope names. That is why it lives under
`dev/`, binds to loopback, and warns on boot. Never deploy it, and never copy its request handling into the service.
