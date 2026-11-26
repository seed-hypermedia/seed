---
name: The Seed desktop app
summary: The Seed desktop app is the Electron app that runs a full Hypermedia node on your machine, and this page says how its processes fit together, where it keeps data, how editing works, and how to run it.
---
The Seed desktop app is the main way a person reads and writes on the [Hypermedia network](../protocol.md). It is a browser, an editor and an archive in one app. This site also calls it the Seed app. <!-- id:xKqt7pdM -->

The app runs a full node on your machine. So it keeps everything you open and serves it to other [peers](../protocol/network.md). It signs everything you write with [keys](../protocol/identity.md) that never leave your device. It runs on macOS, Windows and Linux, and you can download it from seed.hyper.media.

# Where the code is <!-- id:Qha__h0A -->

The code is in `frontend/apps/desktop`, package `@shm/desktop`. It is built with Electron, Electron Forge, Vite, React 18, tRPC over Electron IPC, React Query and Tailwind. <!-- id:f1ggyfkp -->

- The main process is `src/main.ts`.
- The preload script is `src/preload.ts`.
- The renderer, the code that draws a window, starts at `src/root.tsx` and picks the page for each route in `src/pages/main.tsx`.
- The editor is `@shm/editor`, and the agents interface is the agents code in `@shm/ui`. [The shared packages](./packages.md) describes both.

# How it talks to the daemon <!-- id:j9SueGPe -->

The running app is several processes: a main process, a renderer for each window, a [daemon](./daemon.md) and, when that setting is on, a local [app environment](./app-environment.md). The main process starts them in this order: <!-- id:Ih-hbijp -->

1. It starts the daemon with `-http.port`, `-grpc.port`, `-p2p.port` and `-data-dir`, and waits for `/debug/version` to answer.
2. It starts its own HTTP server, the API bridge.
3. It looks for a local app environment. It attaches to one that is already running. It starts the bundled one only when the local server setting is on.

A fresh install does not start a local app environment. It uses the hosted one.

The renderer and the main process both talk to the daemon over gRPC-web on the HTTP port. TypeScript does not use the native [gRPC](../build/grpc.md) port. The renderer and the main process talk to each other over tRPC. <!-- id:vBQ_4i5w -->

The API bridge is the app's local copy of the [Seed API](../build/web-api.md). It serves the same typed `/api/<Key>` routes as a [site](../protocol/sites.md), from the same code. So the [CLI](./cli.md), the local app environment and the renderer itself can use the Seed API against the local node. The bridge refuses requests that a browser sends from another website. The [port table](../software.md) lists the daemon ports and the bridge port for released and development builds.

Two things run once for the whole app, in the main process, and not once for each window. <!-- id:bEGlWROF -->

- **The sync service**, [`src/app-sync.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/desktop/src/app-sync.ts). It keeps a counted list of the resources that any window shows. It runs [discovery](../protocol/network.md) for each of them in a loop, polls the daemon's activity feed, and tells every window which React Query data is out of date. When no window has focus, its intervals are ten times longer.
- **The notification store**, described on [Notify](./notify.md).

Windows also share hover state. When you point at a [block](../protocol/blocks.md) or a resource, the app sends `hypermediaHoverIn` over IPC, and every window highlights the matching resources through `data-resourceid`. A block highlight uses `data-id` inside the matching `data-highlight-resource` container, so the app does not highlight blocks in other resources.

While the daemon starts or reindexes its database, a small loading window shows its progress. The window has no titlebar and no window buttons. Drag anywhere on the loading panel to move it out of the way. The **Force Active State** button, which only development builds show, stays clickable. <!-- id:LdWnDrag -->

# Configuration

The app has four settings that matter to a person who builds or runs it.

- **Ports.** A released app and a development app use different daemon and bridge ports, so both can run at the same time. The development values come from `.env.vars`. See the [port table](../software.md).
- **Local app environment.** The switch under Settings > App environments turns the bundled server on or off. `SEED_NO_APPS_SPAWN` skips it, and `SEED_APPS_SERVER_URL` attaches the app to a server that you name. [The app environment](./app-environment.md) gives the full order.
- **Notify service.** The build sets the default with `VITE_NOTIFY_SERVICE_HOST`, and account settings can override it. See [The notify API](../build/notify-api.md).
- **Integrated web browser.** Off by default. See [The web browser](#the-web-browser).

# Where it keeps things <!-- id:rXZ_ZjIJ -->

The app keeps user data in Electron's application-data folder: `~/Library/Application Support/Seed` on macOS, `~/.config/Seed` on Linux, `%APPDATA%\Seed` on Windows. In development the folder is `Seed-local`, so a development app and a released app can run side by side. Inside the folder: <!-- id:EYMlNBCN -->

- `daemon/` is the daemon's data directory. It holds the SQLite database, the device key and the encrypted local vault file, which can sync with the [vault](./vault.md) service.
- `drafts/` holds drafts as files.
- `agents/` holds the database and files of a local app environment that the app started.

Drafts and navigation state belong to the app. The daemon does not store them, so drafts do not sync between devices. Published [documents](../protocol/documents.md) and [private documents](../protocol/privacy.md) do sync.

# How editing works <!-- id:xYheVJy4 -->

Every [document](../protocol/documents.md) goes through the same four states: loading, viewing, editing, publishing. <!-- id:BBUkrOxT -->

<!-- id:WnDSQNRy -->
1. **Loading.** The app asks the local daemon. If the document is not there, the daemon [discovers](../protocol/network.md) it: it looks for it on other peers. <!-- id:1BHZsZSA -->
2. **Viewing.** You can read but not change. If you have edit access and you left a draft, the app opens the draft again in editing mode. <!-- id:LDea0MAW -->
3. **Editing.** The app saves a draft about half a second after you stop typing. It creates the draft on the first change and updates it after that. Saves wait in a queue, so the app never loses what you type during a save. Cancel discards the draft. <!-- id:E2h3G4po -->
4. **Publishing.** The draft becomes a signed [change](../change.md) and [ref](../ref.md), and the app publishes them through the daemon. If that works, the app deletes the draft. If it fails, you are back in editing and the draft is unchanged. <!-- id:hzXwi2-H -->

If you switch to an [account](../protocol/identity.md) without [edit access](../protocol/permissions.md), the app saves the draft and leaves editing. If someone publishes a newer [version](../protocol/documents.md) while you edit, the app tells you and does not force it on you. The whole flow is one state machine in `@shm/shared`, which the [web app](./web.md) uses too. <!-- id:l1TTUQ1A -->

"New" on a document creates a child draft in place. A card with a title you can edit appears at the bottom of the parent, and opening the card goes to the full editor. Every unpublished child draft of the document you are viewing shows as a card there. The app does not change the parent until the child is published, so there is nothing to discard on the parent. `buildInlineDraftWrite` in `@shm/shared` builds the write, and the app stores it like any other draft. <!-- id:KRj-N47e -->

The editor itself is the shared `@shm/editor` package. [The shared packages](./packages.md) describes its schema, its typography and how embeds are rendered.

# Inspecting the raw data <!-- id:D8QcuKZ1 -->

Two screens, which only the desktop app has, show the protocol data directly. <!-- id:SHBUOTJL -->
  - **The metadata editor** is a tab on every document. It edits [metadata](../metadata.md) as a form or as JSON. It prepares its changes through the same document state machine as the settings panel. When you remove a key, it prepares an explicit null, so the published change clears the key. A rename is a removal and an addition. Lists are turned off, because the [attribute operation](../change/op/set-attributes.md) has no list value type. <!-- id:ZbJkpyrz -->
  - **The blob editor**, the `raw-blob` route, opens any `ipfs://` [CID](../cid.md) that decodes as [DAG-CBOR](../schema/dag-cbor.md), and shows it as [DAG-JSON](../schema/dag-json.md). You can edit it and publish it as a new [blob](../protocol/blobs.md) with a sha2-256 CID. It reads through the daemon's `/ipfs/<cid>.dagjson` route, which searches the network if the blob is not on your machine. Before it encodes, the editor turns links and bytes back into real [IPLD](../schema/ipld.md) values. So publishing a blob with links again does not damage them. <!-- id:c2j4SNRG -->

The daemon stores a blob that you publish this way, but the blob is not public until a public change, [comment](../protocol/comments.md) or [profile](../profile.md) links its CID. See [Files](../protocol/files.md). The [Explorer](./explorer.md) covers the reading half in any browser. <!-- id:KZF_2w5v -->

# The web browser <!-- id:73UsGmWy -->

The desktop app can open ordinary websites in a pane beside the sidebar and the agents panel. The pane is off by default. The **Integrated Web Browser** switch under Settings, Advanced turns it on. <!-- id:bZN58TYv -->

With the switch off:

- Web links, and any website you type into the address bar, open in the system browser.
- The address bar only opens Hypermedia addresses.
- Agents are not offered the `browser` tool.

Every link asks the main process at the moment it opens, so a change of the switch takes effect in every open window at once. The app also forces the switch off when the bundled Chromium is older than the release policy allows. So a build without security patches never shows websites. The security model, the consent an agent needs for each website, and the blocklists are described in `apps/docs/integrated-browser.md` in the repository.

The header of the pane shows the page's icon and title, a private-page button, the tracking-protection shield with the number of blocked requests, reload, **Open in default browser** and a menu. The address itself is in the address bar. <!-- id:md1Ct6ly -->

The pane opens websites over https first:

- The app tries a plain `http://` address as `https://` before it sends any unencrypted request. This holds for an address that you type or click, that a page redirects to, that history restores, or that an agent asks for. So a site that only redirects to https never loads over http.
- When the encrypted address does not answer, the pane shows a warning inside a thick red frame. "Does not answer" means refused, not found, a bad certificate, or nothing after ten seconds. The warning names the host and offers **Show the page anyway** or **Go back**.
- If you accept with a real click, the app allows that origin for the rest of the session. It then shows the website inside a red frame for as long as the page on screen is http. Private pages keep their own list, and **Clear browsing data** forgets both lists.
- Loopback addresses such as `http://localhost:3000` are secure and need no warning.
- An agent whose `navigate` command would land on the warning is refused. The app tells it that the user has to allow the site first.

# Running it <!-- id:TUREvD9- -->

Run it with `./dev run-desktop`, which builds the [daemon](./daemon.md) first. Use `pnpm desktop` when the daemon is already built. <!-- id:Jy3fR8Ts -->

- `pnpm --filter @shm/desktop dev:debug` opens the Chrome DevTools Protocol on port 9222. Automated tools use it to take screenshots of the development app and to move around in it. <!-- id:n_W-tKfy -->
- `./dev 2-run-desktop` starts a second, packaged copy of the app on other ports with its own user data folder. <!-- id:ozrko7-x -->
- `pnpm desktop:test:unit`, from the root, runs the unit tests. `pnpm desktop:test` runs the end-to-end suite, which packages the app and drives it with Playwright. <!-- id:B6U5oo4T -->
- The app updates itself from `latest.json`. Updates on Linux use custom code. See [Releasing](../contribute/releasing.md).

# Working with it <!-- id:80mk_eOH -->

## CLI <!-- id:QkjOH_65 -->

`seed-cli space dev` [publishes a folder](../build/publish-a-folder.md) into the running development app under a throwaway key. It writes edits made in the app straight back to disk. `./dev hm-sync` runs that loop for this documentation folder. The [CLI](./cli.md) can also read the app's local vault file and keys. See [Keys](../build/keys.md). <!-- id:rysrbrBF -->

## SDK <!-- id:ycGhDHE7 -->

The renderer publishes with `@seed-hypermedia/client`, the [SDK](../build/sdk.md), through the API bridge. It signs with the daemon's `SignData` call, so the private key never enters the renderer. <!-- id:P2I7YGN6 -->

## Seed API <!-- id:N56osENV -->

`http://localhost:56004/api/<Key>` is the local [Seed API](../build/web-api.md), served by the API bridge. A local app environment that the app starts uses this address as its site. <!-- id:9yPbD6dG -->

## Agents <!-- id:n3tPWtmN -->

The desktop app shows the agents interface. It talks to the hosted [app environment](./app-environment.md) by default. It can also run a local one, and you can add hosted or self-hosted app environments in Settings. [Seed Agents](../agent.md) describes the chat, the tools and the [triggers](../trigger.md), and [Agents in the app](../agent/in-the-app.md) describes the interface. <!-- id:tUaDmTAs -->

## Notifications <!-- id:riGr4_J9 -->

The inbox page reads a local copy of the account's notification state. The main process syncs that copy with the [notify service](./notify.md) and signs its requests through the daemon. You can mark things as read offline, and the app syncs the change later. [Notify](./notify.md) describes the store. [The notify API](../build/notify-api.md) describes how the app finds its notify service, and the read-state rules. <!-- id:rYGtdY_I -->

## Creating a space

A link to a site's `/hm/create-site` page opens the app's own **Create a space** panel instead of a page. As on the [web app](./web.md), the form comes first. Without an identity, the app asks you to sign in or create one when you submit. If the account already has a [space](../protocol/spaces.md), the panel offers **Go to your space** or **Use a different account**, which creates a new identity.

## Publishing to a domain

After you first publish a new [space](../protocol/spaces.md) in public, the app offers to publish it to a web domain. The space settings also have a **Web Domain** page. The [web app](./web.md) has the same flow, and one page describes it: [Publishing a space to a domain](../operate/publishing-to-a-domain.md).

# See also <!-- id:CVQjdOA9 -->

- [The daemon](./daemon.md), [The app environment](./app-environment.md), [The CLI](./cli.md), [The web app](./web.md), [The shared packages](./packages.md) <!-- id:IOPgXQO6 -->
- [Documents](../protocol/documents.md), [Identity](../protocol/identity.md), [Publish a folder](../build/publish-a-folder.md) <!-- id:xg6Cx51h -->
- [Custom pages](../build/custom-pages.md): documents that open as sandboxed HTML pages, built by agents and shared like any document.
- [App](../app.md): a document that collects [tools](../tool.md), [pages](../page.md) and [triggers](../trigger.md), shown in the desktop app as Home, Tools, Pages and Settings tabs.
- [Publishing a space to a domain](../operate/publishing-to-a-domain.md) and [Releasing](../contribute/releasing.md)
