---
name: The Seed desktop app
summary: The Electron app that is a full Hypermedia peer, how its processes fit together, where it keeps its data, how document editing flows, and the blob and metadata editors it adds for inspection.
---
The Seed desktop app is a browser for the [Hypermedia network](../protocol.md), an editor, and an archive at once. It runs a full node on your machine, so everything you open is kept locally and served to [peers](../protocol/network.md). Everything you write is signed with [keys](../protocol/identity.md) that never leave your device. It runs on macOS, Windows and Linux and is downloadable from seed.hyper.media.

# Where the code is

`frontend/apps/desktop`, package `@shm/desktop`: Electron 39 with Electron Forge and Vite 6, React 18, tRPC over Electron IPC, React Query, Tailwind. The main process is `src/main.ts`, the preload is `src/preload.ts`, and the renderer starts at `src/root.tsx` and dispatches routes from `src/pages/main.tsx`. The editor is `@shm/editor`. The agents interface is the shared `@shm/ui` agents code. Run it with `./dev run-desktop` after `./dev` has built the [daemon](./daemon.md), or `pnpm desktop` alone.

# Processes and ports

The app is four processes. The main process spawns the [daemon](./daemon.md) with `-http.port`, `-grpc.port`, `-p2p.port` and `-data-dir`, waits for `/debug/version`, then starts its own HTTP server and finally a local [agents server](./agents.md).

| Piece | Prod | Dev |
| --- | --- | --- |
| Daemon P2P / HTTP / gRPC / metrics | 56000 / 56001 / 56002 / 56003 | 58000 / 58001 / 58002 / 58003 |
| Desktop API bridge | 56004 | 58004 |
| Agents server | 3050 | 3051 |
| Electron user data | `Seed` | `Seed-local` |

The renderer and the main process both talk to the daemon over gRPC-web on the HTTP port. TypeScript does not use the native [gRPC](../build/grpc.md) port. The renderer and main process talk to each other over tRPC. The API bridge on 56004 serves the same typed `/api/<Key>` protocol as a web site, from the same code. So the [CLI](./cli.md), the local agents server and the renderer itself can use the [Seed API](../build/web-api.md) against the local node. The bridge refuses cross-site browser requests.

# Where it keeps things

User data is Electron's per-platform application-data folder: `~/Library/Application Support/Seed` on macOS, `~/.config/Seed` on Linux, `%APPDATA%\Seed` on Windows. Inside it, `daemon/` is the daemon's data directory with the SQLite database, the device key and the encrypted vault. `drafts/` holds drafts as files. Drafts and navigation state belong to the app, and the daemon does not store them. So drafts do not sync between devices. Published [documents](../protocol/documents.md) and [private documents](../protocol/privacy.md) do sync. In development the folder is `Seed-local`, so a dev app and a production app can run side by side.

# How editing works

Every [document](../protocol/documents.md) goes through the same four states: loading, viewing, editing, publishing.

1. **Loading.** The app asks the local daemon. If the document is not there, the daemon [discovers](../protocol/network.md) it from peers.
2. **Viewing.** Read-only. If you have edit access and left a draft, the app reopens it in editing mode.
3. **Editing.** Autosave writes a draft about half a second after you stop typing. It creates the draft on the first change and updates it after that. Saves queue, so keystrokes during a save are never lost. Cancel discards the draft.
4. **Publishing.** The draft becomes a signed [change](../change.md) and [ref](../ref.md), published through the daemon. On success the draft is deleted. On failure you are back in editing with the draft intact.

Switching to an [account](../protocol/identity.md) without [edit access](../protocol/permissions.md) saves the draft and leaves editing. If a newer [version](../protocol/documents.md) is published elsewhere while you edit, the app notes it and does not force it on you. The whole flow is one state machine in `@shm/shared`, shared with the [web app](./web.md).

# Inspecting the raw data

Two desktop-only surfaces expose the protocol directly.

- **The metadata editor** is a tab on every document. It edits [metadata](../metadata.md) as a form or as JSON and stages patches through the same document machine as the settings panel. Removing a key stages an explicit null, so the published change clears it. Renaming stages a removal and an addition. Lists are disabled because the [attribute operation](../change/op/set-attributes.md) has no list value type yet.
- **The blob editor**, the `raw-blob` route, opens any `ipfs://` [CID](../protocol/blobs.md) that decodes as DAG-CBOR and shows it as DAG-JSON. You can edit it and publish it as a new [blob](../protocol/blobs.md) with a sha2-256 CID. It reads through the daemon's `/ipfs/<cid>.dagjson` route, which searches the network if the blob is not local. Links and bytes are converted back to real IPLD values before encoding, so republishing a blob with links does not corrupt them.

A blob you publish this way is stored but is not public until a public change, [comment](../protocol/comments.md) or profile links its CID. See [Files](../protocol/files.md).

# Working with it

## CLI

`seed-cli space dev` [publishes a folder](../build/publish-a-folder.md) into the running dev app under a throwaway key and writes edits made in the app straight back to disk. `./dev hm-sync` runs that loop for this documentation folder. The [CLI](./cli.md) can also read the app's [vault](./vault.md) and keys. See [Keys](../build/keys.md).

## SDK

The renderer publishes through `@seed-hypermedia/client`, the [SDK](../build/sdk.md), against the API bridge. It signs with the daemon's `SignData` RPC, so the private key never enters the renderer.

## Web API

`http://localhost:56004/api/<Key>` is the local [Seed API](../build/web-api.md). The bundled agents server uses this endpoint.

## Agents

The desktop app starts a local [agents server](./agents.md) and shows the agents interface. You can configure hosted or self-hosted agent servers in its place. The chat, tools and [triggers](../agent/triggers.md) are described under [Seed Agents](../agent.md).

# Development notes

- `pnpm desktop dev:debug` opens Chrome DevTools Protocol on 9222. Automated drivers use it to screenshot and navigate the dev app.
- `./dev 2-run-desktop` starts a second packaged instance on alternative ports with its own user data folder.
- Unit tests run with `pnpm test:unit`. The end-to-end suite packages the app and drives it with Playwright. Auto-updates on Linux are custom. See the release process in [Contributing](../build/contributing.md).

# See also

- [The daemon](./daemon.md), [The agents service](./agents.md), [The CLI](./cli.md), [The web app](./web.md)
- [Documents](../protocol/documents.md), [Identity](../protocol/identity.md), [Publish a folder](../build/publish-a-folder.md)
