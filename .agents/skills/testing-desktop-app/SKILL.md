---
name: testing-desktop-app
description: Build, run, and smoke-test the Seed Hypermedia Electron desktop app locally (render a window, open synced content, navigate). Use when verifying the desktop app boots and functions in a headless/sandboxed Linux VM, or when the daemon fails to start due to keyring/dbus errors.
---

# Testing the Seed Desktop (Electron) App

## What this covers
Getting `frontend/apps/desktop` (Electron + electron-forge) to build, launch, render
a window, and perform real actions against the locally-spawned Go daemon + p2p
network. Good for a quick "does it run and work" smoke test.

## Toolchain setup (mise + direnv)
The repo uses `mise` + `direnv` (`mise.toml`, `.envrc`). In a non-interactive shell:

```bash
cd <repo>
mise trust && direnv allow
eval "$(mise activate bash)"
eval "$(direnv export bash)"   # takes ~15s first time; also compiles `plz` (please) from source
```

This puts `go`, `node`, `pnpm`, `bun`, `plz`, `protoc` on PATH and exports the dev
env vars (ports 58000/58001/58002, `VITE_DESKTOP_*`, `SEED_P2P_TESTNET_NAME=dev`, etc.).
Tip: dump the two `eval` lines into a helper file and `source` it in each new shell.

## Build
```bash
pnpm install                          # root
plz build //backend:seed-daemon       # Go daemon; also builds vendored llama.cpp (~1 min first time)
```
The dev daemon binary is expected at
`plz-out/bin/backend/seed-daemon-x86_64-unknown-linux-gnu`
(resolved by `frontend/apps/desktop/src/daemon-path.ts`, `../../../plz-out/...`).

## Run
```bash
cd frontend/apps/desktop
SEED_KEYSTORE_DIR=/home/ubuntu/.config/Seed-local/keystore VITE_XSTATE_INSPECT=true pnpm dev
```
`./dev run-desktop` also works but requires an interactive direnv shell.

### CRITICAL: daemon keyring / dbus workaround
On a headless/sandboxed Linux VM (no dbus / secret-service) the spawned Go daemon
crashes on boot with:
```
failed to create production keystore: failed reading vault credentials from keyring:
dbus: invalid bus address (invalid or unsupported transport)
```
Fix: set **`SEED_KEYSTORE_DIR=<dir>`** before launching. The daemon then uses a
file-based keystore instead of the OS keyring (see
`backend/cmd/seed-daemon/main.go` keystore selection + `backend/config/config.go`
`KeystoreDir` / `-keystore-dir` flag; env var maps via the `SEED` prefix). The desktop
app passes its environment through to the daemon it spawns, so setting it on `pnpm dev`
is enough.

Trade-off: a file keystore is **not** a Vault, so `GetVaultStatus` fails with
`the underlying key store type *keystore.fileStore is not a vault.Vault`. This breaks
vault-dependent **identity/account creation**, so avoid testing onboarding/account
creation with this workaround — demonstrate read + navigation instead. If you must
test account creation, a real dbus session + gnome-keyring may be needed instead (may
or may not work in the sandbox).

## Verifying it works (smoke test)
Wait for daemon logs `DaemonStarted` + `P2PNodeReady`, then the app logs
`main window created`. In the window:
1. Onboarding "Welcome to Seed Hypermedia" screen renders.
2. Click a site under "Joined Sites" (e.g. "Seed Hypermedia") → loads real p2p content
   (`https://seed.hyper.media`, "N members collaborating", doc cards, activity feed).
3. Click a document card → full document renders (hero, title, byline, rich blocks).
4. Click "Library" in the sidebar → Subscribed/Bookmarks/All tabs load.

## Gotchas
- **Single-instance lock:** Electron uses a SingletonLock in the userData dir
  (`~/.config/Seed-local/`). A stale/backgrounded instance makes new launches log
  "Another Seed already running. Quitting." Kill all `electron/dist/electron` +
  `seed-daemon` PIDs and `rm -f ~/.config/Seed-local/Singleton{Lock,Socket,Cookie}`
  before relaunching. Don't launch via one-shot `cmd &` (it detaches and holds the
  lock); use a persistent shell.
- Non-fatal noise you can ignore: `Failed to connect to the bus` (dbus), GPU
  `Exiting GPU process due to errors during initialization`, an insecure-CSP dev
  warning, a React "unique key" warning in `SystemMenu`, and p2p bootstrap dial
  failures (content still syncs).
- Ports (dev/testnet): HTTP 58001, gRPC 58002, p2p 58000. userData: `~/.config/Seed-local`.

## Devin Secrets Needed
None. Everything runs locally; no external credentials required for this smoke test.
