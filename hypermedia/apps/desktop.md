---
name: The Seed desktop app
summary: The Electron app that is a full Hypermedia peer, how its processes fit together, where it keeps its data, how document editing flows, and the blob and metadata editors it adds for inspection.
---
The Seed desktop app is a browser for the Hypermedia network, an editor, and an archive at once. It runs a full node on your machine, so everything you open is kept locally and served to peers, and everything you write is signed with keys that never leave your device. It runs on macOS, Windows and Linux and is downloadable from seed.hyper.media.

# Where the code is

`frontend/apps/desktop`, package `@shm/desktop`: Electron 39 with Electron Forge and Vite 6, React 18, tRPC over Electron IPC, React Query, Tailwind. The main process is `src/main.ts`, the preload is `src/preload.ts`, and the renderer starts at `src/root.tsx` and dispatches routes from `src/pages/main.tsx`. The editor is `@shm/editor`; the agents interface is the shared `@shm/ui` agents code. Run it with `./dev run-desktop` after `./dev` has built the daemon, or `pnpm desktop` alone.

# Processes and ports

The app is four processes. The main process spawns the [daemon](./daemon.md) with `-http.port`, `-grpc.port`, `-p2p.port` and `-data-dir`, waits for `/debug/version`, then starts its own HTTP server and finally a local [agents server](./agents.md).

| Piece | Prod | Dev |
| --- | --- | --- |
| Daemon P2P / HTTP / gRPC / metrics | 56000 / 56001 / 56002 / 56003 | 58000 / 58001 / 58002 / 58003 |
| Desktop API bridge | 56004 | 58004 |
| Agents server | 3050 | 3051 |
| Electron user data | `Seed` | `Seed-local` |

Both the renderer and the main process talk to the daemon over gRPC-web on the HTTP port; the native gRPC port is unused by TypeScript. The renderer and main process talk to each other over tRPC. The API bridge on 56004 serves the same typed `/api/<Key>` protocol as a web site, from the same code, so the CLI, the local agents server and the renderer itself can use the Seed API against the local node. It refuses cross-site browser requests.

# Where it keeps things

User data is Electron's per-platform application-data folder: `~/Library/Application Support/Seed` on macOS, `~/.config/Seed` on Linux, `%APPDATA%\Seed` on Windows. Inside it, `daemon/` is the daemon's data directory with the SQLite database, the device key and the encrypted vault; `drafts/` holds drafts as files. Drafts and navigation state belong to the app, not the daemon, so they do not sync between devices, while published documents and private documents do. In development the folder is `Seed-local`, so a dev app and a production app can run side by side.

# How editing works

Every document goes through the same four states: loading, viewing, editing, publishing.

1. **Loading.** The app asks the local daemon; if the document is not there, the daemon discovers it from peers.
2. **Viewing.** Read-only. If you have edit access and left a draft, the app reopens it in editing mode.
3. **Editing.** Autosave writes a draft about half a second after you stop typing, creating the draft on the first change and updating it after. Saves queue, so keystrokes during a save are never lost. Cancel discards the draft.
4. **Publishing.** The draft becomes a signed [change](../change.md) and [ref](../ref.md), published through the daemon. On success the draft is deleted; on failure you are back in editing with the draft intact.

Switching to an account without edit access saves the draft and leaves editing. A newer version published elsewhere while you edit is noted, not forced on you. The whole flow is one state machine in `@shm/shared`, shared with the web app.

# Inspecting the raw data

Two desktop-only surfaces expose the protocol directly.

- **The metadata editor** is a tab on every document. It edits metadata as a form or as JSON and stages patches through the same document machine as the settings panel. Removing a key stages an explicit null so the published change actually clears it; renaming stages a removal and an addition. Lists are disabled because the attribute operation has no list value type yet.
- **The blob editor**, the `raw-blob` route, opens any `ipfs://` CID that decodes as DAG-CBOR, shows it as DAG-JSON, lets you edit it and publish it as a new blob with a sha2-256 CID. It reads through the daemon's `/ipfs/<cid>.dagjson` route, which searches the network if the blob is not local. Links and bytes are converted back to real IPLD values before encoding, so republishing a blob with links does not corrupt them.

Keep in mind the rule from [Files](../protocol/files.md): a blob you publish this way is stored but not public until a public change, comment or profile links its CID.

# Working with it

## CLI

`seed-cli space dev` publishes a folder into the running dev app under a throwaway key and writes edits made in the app straight back to disk. `./dev hm-sync` runs that loop for this documentation folder. The CLI can also read the app's vault and keys; see [Keys](../build/keys.md).

## SDK

The renderer publishes through `@seed-hypermedia/client` against the API bridge, signing with the daemon's `SignData` RPC so the private key never enters the renderer.

## Web API

`http://localhost:56004/api/<Key>` is the local Seed API. It is the endpoint the bundled agents server uses.

## Agents

The desktop app starts a local agents server and shows the agents interface; hosted or self-hosted agent servers can be configured instead. The chat, tools and triggers are described under [Seed Agents](../agent.md).

# Development notes

- `pnpm desktop dev:debug` opens Chrome DevTools Protocol on 9222, which is how automated drivers screenshot and navigate the dev app.
- `./dev 2-run-desktop` starts a second packaged instance on alternative ports with its own user data folder.
- Unit tests run with `pnpm test:unit`; the end-to-end suite packages the app and drives it with Playwright. Auto-updates on Linux are custom; see the release process in [Contributing](../build/contributing.md).

# See also

- [The daemon](./daemon.md), [Seed Agents](./agents.md), [The CLI](./cli.md)
- [Documents](../protocol/documents.md), [Identity](../protocol/identity.md)
