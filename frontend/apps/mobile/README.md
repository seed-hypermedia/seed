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

- `watchFolders` includes the monorepo root (for the client package sources)
- `nodeModulesPaths`: app `node_modules` first, then the monorepo root
- forces a single copy of react/react-dom (the app's React 19)

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
