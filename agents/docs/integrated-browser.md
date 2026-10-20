# Integrated desktop browser tools

Enable the experimental web browser in Seed desktop's Advanced settings and open a website. When the assistant panel
shows a session with an agent you own, it asks whether that agent may use the website. Nothing is shared until you allow
it.

## Access model

The user's signed-in browser is the thing being protected. The agent server, other people in a session, and every
website are treated as untrusted.

- **Read-only by default.** "Allow on this website" grants `read`: snapshot, screenshot and scroll. "Allow actions on
  this website" upgrades that origin to `act`: click, type, press, navigate and archive, as well as reading. The panel
  explains that action access lets the agent click and type as the user. Grants cover only that session. Pause stops new
  commands. Revoke forgets every allowed website.
- **Owner only.** Only the agent's owner is offered access. Collaborators and public chatters never are. Public agents
  never get the browser, and making an agent public closes any open connection.
- **Owner-started turns only.** The agent server runs a browser command only inside an interactive turn that the
  connected owner started by sending a message. Triggers, delegated and child sessions, workflows, retries and
  continuations cannot use the browser.
- **Enforced in Electron.** The main process keeps the allowed websites on the grant. It refuses a command when the page
  is on any other website, both before and after the page script runs. Action commands on read-only origins are refused
  with a message asking the user to allow actions.
- **Asking before leaving.** When the agent wants to open a website you have not allowed, the panel offers **Allow
  reading**, **Allow actions** and **Deny** before any request is made. Navigation requires action access on the source
  website; allowing reading opens the destination with read-only access. Redirects must also stay on approved websites.
- **No private networks.** Agent navigation refuses loopback, private, link-local and `.local` addresses, including
  hostnames that resolve to them. Commands are also refused on a page whose main response came from a private address
  behind a public hostname (DNS rebinding). A website you opened at a literal local address, like
  `http://127.0.0.1:3000`, can still be allowed by hand.

## Discovery and actions

Discover the tool with `read ~/tools/browser`, then invoke `call` with `tool: "browser"` and an `input` object:

- `snapshot` reads the text a person can see, source metadata, viewport information and interactive element references.
  Transparent, clipped, off-page and tiny text is left out.
- `screenshot` returns the page viewport to a vision-capable model.
- `scroll` moves through the page with read access. `click`, `type` and `press` require action access. Typing into
  password and other secret fields is refused, and so is typing into or submitting a form that posts to another website.
- `navigate` opens an HTTP(S) URL on an allowed website, or asks the user first. Agents cannot open Seed links; the user
  opens those. A plain `http://` address is tried over https first, like every navigation in the pane; when only
  unencrypted http answers, the command is refused and the pane shows the user the warning, which only they can accept.
- `archive` creates an editable desktop draft and saves a Markdown copy in the owner-only `~/memory/private/browser/`
  folder. Images are fetched once and stored locally, so the draft never loads the source site.

The panel’s **Browser activity** disclosure shows the last 20 commands with time, action, origin and `ok`/`refused`
outcome. **Copy log** copies the complete in-memory list for that panel session. It includes no page content, typed
values, query strings or fragments. The list survives pause and revoke, but is discarded when the session panel closes
or switches sessions; it is never persisted.

Every action except `snapshot` requires its returned `document` token. Click and type require an observed `ref`. Tokens
expire on a new snapshot or navigation. Page content is untrusted material, never permission or instructions.

## Privacy of results

Browser results stay with the owner:

- Session transcripts, run journals, WebSocket updates, continuation handoffs and search show readers a fixed stub in
  place of browser calls and anything derived from them. The owner and the owner's own turns see the full content.
- `private/` in agent memory is owner-only in every memory API and verb, and it is kept outside the shared code sandbox
  mount. Existing `memory/private/` folders and old `browser/archive-*.md` captures move there on startup.
- The assistant message context only names the website (origin and path, no query or fragment) while access is
  connected. Otherwise it says a website is open without naming it.

## Other website protections

- The website runs in a `WebContentsView` owned by the main process. The app page never holds a web view: it asks for a
  guest, reports where to draw it, and receives events. `webviewTag` is off in every window.
- Guest bounds are clamped to the window content area, and the app hides the native view while overlays are open.
- Paste and drag from websites use the same BlockNote schema parser as other external HTML. Scripts and event handlers
  are not document content; link parsing rejects script and data URLs, including forged `data-hm-link` attributes.
- Browser output is tool data. Page text asking to sign or publish cannot execute a write; publishing still requires an
  explicit call through the normal write tool and its available write keys.
- Websites get no permissions except clipboard writes confirmed after a click. They never auto-select a client
  certificate, and can only download after a click, with a save dialog.
- A page can only switch the app to a Seed page or open a popup right after real user input, and never while an agent
  command runs.
- Favicons and archived images are read with a size cap and must be images.
- Settings has **Clear browsing data** for the browser's own session.

## Known-bad websites (Phase 2.1)

The browser partition blocks main-frame navigation to listed hosts and their subdomains. Typed addresses, restored
history, page links and redirects are checked; agent navigation to listed hosts is refused before loading the page. The
Seed warning names the host and the list that flagged it. It offers **Go back** and **Open in default browser**, with no
option to continue inside the pane. This policy does not install request handlers on the app's own session.

A small bundled **Seed test sites** list includes `malware.testing.google.test`, `phishing.testing.google.test` and
`phishing.seed.test`. These are test entries, not a complete offline threat database. The live source is the
[OpenPhish community URL feed](https://openphish.com/feed.txt); URLhaus and Phishing.Database are not enabled.

The browser loads its last valid cache from `browser/blocklist.json` under Electron's `userData` before creating a
guest. It attempts a background refresh at startup and on a daily timer, with at least 24 hours between attempts,
including failed attempts and restarts. Requests send `If-None-Match` when an ETag is available, time out after 30
seconds, and reject feeds larger than 1 MiB of decoded response bytes. A `304` keeps the existing rules. Failed,
oversized or empty updates preserve the last valid list and the bundled test entries.

## Tracker and content blocking (Phase 2.2)

Network request blocking is on by default for the `persist:seed-web-browser` partition. Seed uses `@ghostery/adblocker`
2.18.2 directly inside its existing request handler, so filtering does not replace the private-network guard or the
known-bad-site blocklist. The Electron wrapper supports Electron 44, but its automatic session setup would replace those
handlers. No blocker handler is installed on the app session. Configured daemon, file-service and agent-server origins,
including the running local agent server, are excluded as both destinations and page sources. Cosmetic filtering and
script injection are not enabled.

The shield in the pane header shows the number of requests blocked on the current page. **Allow trackers on a host**
applies to that exact origin, including scheme and port, and reloads the page. The setting is saved in the app store
under `browser-allow-trackers`. It applies to the page's subframes too and does not disable phishing or private-network
protection. Counts belong to each guest, reset for a new document, and remain through same-document navigation. The main
process sends `browser-blocked-count` window events containing the guest ID, page URL, count and allow setting.

Updates use [EasyList](https://easylist.to/easylist/easylist.txt) and
[EasyPrivacy](https://easylist.to/easylist/easyprivacy.txt). The compiled engine is cached in
`browser/content-blocker.json` under Electron's `userData`. The first launch loads the bundled engine without fetching
tracker lists. Background refreshes occur at most once every 24 hours, including failures and restarts. Each list has an
8 MiB decoded-response cap and a 30-second timeout; the serialized engine has a 16 MiB cap. Both lists must validate
before an update replaces the engine. Failed updates keep the last valid engine.

**Offline coverage is currently limited.** Ghostery 2.18.2 ships neither list text nor a prebuilt engine: its
`fromPrebuiltAdsAndTracking` method fetches lists at runtime. The current bundled snapshot contains only four Seed
starter rules for `doubleclick.net`, `googlesyndication.com`, `google-analytics.com` and `googletagmanager.com`. Full
EasyList/EasyPrivacy protection begins after a successful daily refresh. Bundling a full offline snapshot remains
unfinished because the build environment cannot reach the list servers.

To replace the starter snapshot, place full upstream `easylist.txt` and `easyprivacy.txt` files in
`frontend/apps/desktop/src/browser-filter-lists/` and run `pnpm --filter @shm/desktop browser:build-filters` from the
repo root. This offline build writes `engine.json` with source URLs and SHA-256 hashes; preserve the upstream
attribution and license notices when distributing the list snapshot. Rebuild the snapshot whenever the engine dependency
changes.

## Transport and verification

Desktop long-polls the existing signed Agents API, so local and remote agent servers use the same path. Connections are
bound to the session, the owner's account and signer, and a random window connection ID. A second window cannot take
over. Commands are delivered once, with leases and execution deadlines; uncertain actions are not replayed.

Coverage includes the signed relay and its authorization, run gating and reader redaction (`agents/src`), the consent
panel, policy modules and the real Electron fixture in `frontend/apps/desktop/tests/web-browser.e2e.ts`.

## Third-party cookies (Phase 1.5)

Electron 44.5.1 exposes cookie storage and Storage Access permissions, but no supported per-session third-party cookie
toggle. Chromium feature switches are process-wide and are not a stable partition policy. The browser's network hooks
strip `Cookie` and `Set-Cookie` on requests outside the top-level document's approximate registrable domain. Main-frame
navigations, including every OAuth redirect, retain their cookies. GPC shares the same header hook.

The bundled PSL-free heuristic handles IP literals, single-label hosts, common ccTLD categories such as `co.uk`, and a
small set of shared hosting suffixes. It does not implement the full Public Suffix List or its exceptions; unusual
suffixes can be grouped incorrectly. Unattributed worker and main-process requests cannot be classified and retain
cookies (including authenticated favicon fetches). This is HTTP header filtering, not isolation of JavaScript cookie
access or all third-party storage. Storage Access permission remains denied.

References: [session API](https://www.electronjs.org/docs/latest/api/session),
[cookie API](https://www.electronjs.org/docs/latest/api/cookies), and
[supported switches](https://www.electronjs.org/docs/latest/api/command-line-switches).

## Private pages (Phase 1.5)

**New private page** opens the current URL in the memory-only `seed-web-private` partition with a **Private** badge. It
has the same permissions, network filtering, downloads, GPC and certificate rules as the normal partition. **Close
private page** returns to the normal page. Leaving the web route or closing the window destroys the private guest
without waiting for website unload handlers, then clears storage, cache, authentication and connections. Reopening waits
for erasure to finish. Each window reuses at most one normal and one private guest.

Electron partitions are shared across windows: private pages in different windows share this memory-only session, and
closing one clears its data for all of them. Private mode does not hide activity from websites or the network.

## Clear browsing data (Phase 1.5)

The pane's page menu offers **Clear browsing data** with a confirmation. It calls the same
`experiments.clearBrowserData` operation as Settings: normal browser documents are stopped before cookies, website
storage, cache, authentication and connections are cleared. Settings retains its existing entry. Private data is erased
when the private page closes; it is separate from this normal-session operation.

## Permissions and page dialogs (Phase 1.2)

Permissions stay denied by default. `clipboard-sanitized-write` requires recent real input on that guest, consumes that
gesture, and shows **Copy to clipboard?** with the requesting origin and **Deny** / **Allow**. Agent execution cannot
supply or inherit this gesture. Grants are not remembered; clipboard reading remains denied.

Fullscreen is always denied: a website in a `WebContentsView` must not cover Seed's origin display or navigation. HTML
fullscreen window resizing is disabled as well. An unexpected `enter-html-full-screen` hides the guest and requests exit
without changing the view bounds, then shows an error. Fullscreen denial is covered in the Electron fixture; renderer
crashes are recoverable only through a user reload or **Try again**.

`safeDialogs` includes **Prevent this page from showing more dialogs**. The header reports **<origin> is showing
dialogs** until the next load or guest change. Electron 44 has no public JavaScript-dialog event, so this informational
notice observes its internal `-run-dialog` notification without replacing the native handler or callback. Recheck this
hook on Electron upgrades against
[Electron 44's dialog handler](https://github.com/electron/electron/blob/v44.5.1/lib/browser/api/web-contents.ts).

## Site isolation and guest limits (Phase 1.6)

The session policy checks `disable-site-isolation-trials` once at startup and warns if it is present. Each window has a
hard limit of two guest views, one normal and one private, with a clear creation error if both slots are occupied.
Renderer termination only reports a load error: no automatic reload is scheduled. **Try again** and the normal reload
controls are explicit user actions.
