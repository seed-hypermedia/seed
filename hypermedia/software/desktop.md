---
name: The Seed desktop app
summary: The Electron app that is a full Hypermedia peer, how its processes fit together, where it keeps its data, how document editing flows, and the blob and metadata editors it adds for inspection.
---
The Seed desktop app is a browser for the [Hypermedia network](../protocol.md), an editor, and an archive at once. It runs a full node on your machine, so everything you open is kept locally and served to [peers](../protocol/network.md). Everything you write is signed with [keys](../protocol/identity.md) that never leave your device. It runs on macOS, Windows and Linux and is downloadable from seed.hyper.media. <!-- id:xKqt7pdM -->

# Where the code is <!-- id:Qha__h0A -->

`frontend/apps/desktop`, package `@shm/desktop`: Electron 39 with Electron Forge and Vite 6, React 18, tRPC over Electron IPC, React Query, Tailwind. The main process is `src/main.ts`, the preload is `src/preload.ts`, and the renderer starts at `src/root.tsx` and dispatches routes from `src/pages/main.tsx`. The editor is `@shm/editor`. The agents interface is the shared `@shm/ui` agents code. Both are described on [The shared packages](./packages.md). <!-- id:f1ggyfkp -->

# How it talks to the daemon <!-- id:j9SueGPe -->

The app is a main process, a renderer for each window, a [daemon](./daemon.md) and, when enabled, a local [app environment](./app-environment.md). The main process spawns the daemon with `-http.port`, `-grpc.port`, `-p2p.port` and `-data-dir`, waits for `/debug/version`, then starts its own HTTP server, the API bridge. Last it looks for a local app environment. It attaches to one that is already running, and it spawns the bundled one only when the local server setting is on. A fresh install does not spawn one and uses the hosted app environment. <!-- id:Ih-hbijp -->

The renderer and the main process both talk to the daemon over gRPC-web on the HTTP port. TypeScript does not use the native [gRPC](../build/grpc.md) port. The renderer and main process talk to each other over tRPC. The API bridge serves the same typed `/api/<Key>` protocol as a web site, from the same code. So the [CLI](./cli.md), the local app environment and the renderer itself can use the [Seed API](../build/web-api.md) against the local node. The bridge refuses cross-site browser requests. The [port table](../software.md) lists the daemon ports and the bridge port for released and development builds. <!-- id:vBQ_4i5w -->

Two things run once per app in the main process rather than once per window. The sync service, [`src/app-sync.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/desktop/src/app-sync.ts), keeps a reference-counted list of the resources any window is showing, runs [discovery](../protocol/network.md) for each of them on a loop, polls the daemon's activity feed, and broadcasts React Query invalidations to every window. Its intervals stretch ten times when no window is focused. The notification store described on [Notify](./notify.md) lives there too. Windows also share hover state: pointing at a block or a resource broadcasts `hypermediaHoverIn` over IPC, and every window highlights matching resources through `data-resourceid`. Block highlights use `data-id` within the matching `data-highlight-resource` container, so blocks in other resources are not highlighted. <!-- id:bEGlWROF -->

While the daemon starts or reindexes its database, a compact loading window shows its progress. It has no titlebar or window buttons; drag anywhere on the loading panel to move it out of the way. The development-only **Force Active State** button remains clickable. <!-- id:LdWnDrag -->

# Configuration

The app has few settings that a contributor or operator needs.

- **Ports.** A released app and a development app use different daemon and bridge ports, so both can run at once. The development values come from `.env.vars`. See the [port table](../software.md).
- **Local app environment.** The switch under Settings > App environments turns the bundled server on or off. `SEED_NO_APPS_SPAWN` skips it entirely, and `SEED_APPS_SERVER_URL` attaches the app to a server you name. [The app environment](./app-environment.md) gives the full order.
- **Notify service.** The build sets the default with `VITE_NOTIFY_SERVICE_HOST`, and account settings can override it. See [The notify API](../build/notify-api.md).
- **Integrated web browser.** Off by default. See [The web browser](#the-web-browser).

# Where it keeps things <!-- id:rXZ_ZjIJ -->

User data is Electron's per-platform application-data folder: `~/Library/Application Support/Seed` on macOS, `~/.config/Seed` on Linux, `%APPDATA%\Seed` on Windows. Inside it, `daemon/` is the daemon's data directory with the SQLite database, the device key and the encrypted vault. `drafts/` holds drafts as files. `agents/` holds the database and files of a spawned local app environment. Drafts and navigation state belong to the app, and the daemon does not store them. So drafts do not sync between devices. Published [documents](../protocol/documents.md) and [private documents](../protocol/privacy.md) do sync. In development the folder is `Seed-local`, so a dev app and a production app can run side by side. <!-- id:EYMlNBCN -->

# How editing works <!-- id:xYheVJy4 -->

Every [document](../protocol/documents.md) goes through the same four states: loading, viewing, editing, publishing. <!-- id:BBUkrOxT -->

<!-- id:WnDSQNRy -->
1. **Loading.** The app asks the local daemon. If the document is not there, the daemon [discovers](../protocol/network.md) it from peers. <!-- id:1BHZsZSA -->
2. **Viewing.** Read-only. If you have edit access and left a draft, the app reopens it in editing mode. <!-- id:LDea0MAW -->
3. **Editing.** Autosave writes a draft about half a second after you stop typing. It creates the draft on the first change and updates it after that. Saves queue, so keystrokes during a save are never lost. Cancel discards the draft. <!-- id:E2h3G4po -->
4. **Publishing.** The draft becomes a signed [change](../change.md) and [ref](../ref.md), published through the daemon. On success the draft is deleted. On failure you are back in editing with the draft intact. <!-- id:hzXwi2-H -->

Switching to an [account](../protocol/identity.md) without [edit access](../protocol/permissions.md) saves the draft and leaves editing. If a newer [version](../protocol/documents.md) is published elsewhere while you edit, the app notes it and does not force it on you. The whole flow is one state machine in `@shm/shared`, shared with the [web app](./web.md). <!-- id:l1TTUQ1A -->

"New" on a document creates a child draft in place: a card with an editable title appears at the bottom of the parent, and opening it goes to the full editor. Every unpublished child draft of the document you are viewing shows as a card there. The parent is not changed until the child publishes, so there is nothing to discard on it. The write is built by `buildInlineDraftWrite` in `@shm/shared` and stored like any other draft. <!-- id:KRj-N47e -->

The editor itself is the shared `@shm/editor` package. [The shared packages](./packages.md) describes its schema, its typography and how embeds are rendered.

# Inspecting the raw data <!-- id:D8QcuKZ1 -->

Two desktop-only surfaces expose the protocol directly. <!-- id:SHBUOTJL -->
  - **The metadata editor** is a tab on every document. It edits [metadata](../metadata.md) as a form or as JSON and stages patches through the same document machine as the settings panel. Removing a key stages an explicit null, so the published change clears it. Renaming stages a removal and an addition. Lists are disabled because the [attribute operation](../change/op/set-attributes.md) has no list value type. <!-- id:ZbJkpyrz -->
  - **The blob editor**, the `raw-blob` route, opens any `ipfs://` [CID](../protocol/blobs.md) that decodes as DAG-CBOR and shows it as DAG-JSON. You can edit it and publish it as a new [blob](../protocol/blobs.md) with a sha2-256 CID. It reads through the daemon's `/ipfs/<cid>.dagjson` route, which searches the network if the blob is not local. Links and bytes are converted back to real IPLD values before encoding, so republishing a blob with links does not corrupt them. <!-- id:c2j4SNRG -->

A blob you publish this way is stored but is not public until a public change, [comment](../protocol/comments.md) or profile links its CID. See [Files](../protocol/files.md). The [Explorer](./explorer.md) covers the reading half in any browser. <!-- id:KZF_2w5v -->

# The web browser <!-- id:73UsGmWy -->

The desktop app can open ordinary websites in a pane beside the sidebar and the agents panel. It is off by default. The **Integrated Web Browser** toggle in Settings, Advanced turns it on. With the toggle off, web links and any website typed into the omnibar open in the system browser, the omnibar itself only resolves Hypermedia addresses, and agents are not offered the `browser` tool. Every link asks the main process at the moment it is opened, so flipping the toggle takes effect in every open window at once. The toggle is also forced off when the bundled Chromium is older than the release policy allows, so an unpatched build never shows websites. The security model, the per-website agent consent and the blocklists are described in the app environment's browser notes (`apps/docs/integrated-browser.md` in the repo). <!-- id:bZN58TYv -->

The pane's header shows the page's icon and title, a private-page button, the tracking-protection shield with the number of requests blocked, reload, **Open in default browser** and a menu; the address itself is in the omnibar. Websites are opened over https first: a plain `http://` address, whether typed, clicked, redirected to, restored from history or asked for by an agent, is tried as `https://` before any unencrypted request is sent, so a site that merely redirects to https never loads over http. When the encrypted address does not answer (refused, unresolved, a bad certificate, or nothing after ten seconds), the pane shows a warning inside a thick red frame that names the host and offers **Show the page anyway** or **Go back**. Accepting it, with a real click, allows that origin for the rest of the session (private pages keep their own list; **Clear browsing data** forgets both), and the website is then shown inside a red frame for as long as the page on screen is http. Loopback addresses such as `http://localhost:3000` are secure contexts and need no warning. An agent whose `navigate` command would land on the warning is refused and told that the user has to allow the site first. <!-- id:md1Ct6ly -->

# Running it <!-- id:TUREvD9- -->

Run it with `./dev run-desktop` after `./dev` has built the [daemon](./daemon.md), or `pnpm desktop` alone. <!-- id:Jy3fR8Ts -->

- `pnpm desktop dev:debug` opens Chrome DevTools Protocol on 9222. Automated drivers use it to screenshot and navigate the dev app. <!-- id:n_W-tKfy -->
- `./dev 2-run-desktop` starts a second packaged instance on alternative ports with its own user data folder. <!-- id:ozrko7-x -->
- Unit tests run with `pnpm test:unit`. The end-to-end suite packages the app and drives it with Playwright. Auto-updates on Linux are custom. See the release process in [Contributing](../contribute/contributing.md). <!-- id:B6U5oo4T -->

# Working with it <!-- id:80mk_eOH -->

## CLI <!-- id:QkjOH_65 -->

`seed-cli space dev` [publishes a folder](../build/publish-a-folder.md) into the running dev app under a throwaway key and writes edits made in the app straight back to disk. `./dev hm-sync` runs that loop for this documentation folder. The [CLI](./cli.md) can also read the app's [vault](./vault.md) and keys. See [Keys](../build/keys.md). <!-- id:rysrbrBF -->

## SDK <!-- id:ycGhDHE7 -->

The renderer publishes through `@seed-hypermedia/client`, the [SDK](../build/sdk.md), against the API bridge. It signs with the daemon's `SignData` RPC, so the private key never enters the renderer. <!-- id:P2I7YGN6 -->

## Web API <!-- id:N56osENV -->

`http://localhost:56004/api/<Key>` is the local [Seed API](../build/web-api.md). A spawned local app environment uses this endpoint as its site. <!-- id:9yPbD6dG -->

## Agents <!-- id:n3tPWtmN -->

The desktop app shows the agents interface and talks to the hosted [app environment](./app-environment.md) by default. It can also run a local one, and you can add hosted or self-hosted app environments in Settings. The chat, tools and [triggers](../agent/triggers.md) are described under [Seed Agents](../agent.md), and the interface under [Agents in the app](../agent/in-the-app.md). <!-- id:tUaDmTAs -->

## Notifications <!-- id:riGr4_J9 -->

The inbox page reads a local copy of the account's notification state that the main process syncs with the [notify service](./notify.md), signing requests through the daemon. Marking things read works offline and syncs later. [Notify](./notify.md) describes the store, and [The notify API](../build/notify-api.md) describes how the app finds its notify service and the read-state rules. <!-- id:rYGtdY_I -->

## Publishing to a domain

After the first public publication of a new space the app offers to publish it to a web domain, and space settings has a **Web Domain** page. The flow is shared with the [web app](./web.md) and is described once, in [Publishing a space to a domain](../operate/publishing-to-a-domain.md).

# See also <!-- id:CVQjdOA9 -->

- [The daemon](./daemon.md), [The app environment](./app-environment.md), [The CLI](./cli.md), [The web app](./web.md), [The shared packages](./packages.md) <!-- id:IOPgXQO6 -->
- [Documents](../protocol/documents.md), [Identity](../protocol/identity.md), [Publish a folder](../build/publish-a-folder.md) <!-- id:xg6Cx51h -->
- [Custom pages](../build/custom-pages.md): documents that open as sandboxed HTML pages, built by agents and shared like any document.
- [App](../app.md): a document that collects tools, pages and triggers, shown in the desktop app as Home, Tools, Pages and Settings tabs.
- [Publishing a space to a domain](../operate/publishing-to-a-domain.md)
