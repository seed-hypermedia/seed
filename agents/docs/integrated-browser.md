# Integrated desktop browser tools

Enable the experimental web browser in Seed desktop's Advanced settings and open a website. When the assistant panel
shows a session with an agent you own, it asks whether that agent may use the website. Nothing is shared until you allow
it.

## Access model

The user's signed-in browser is the thing being protected. The agent server, other people in a session, and every
website are treated as untrusted.

- **Opt in per website.** The panel asks "Let <agent> on <server> read, screenshot and act on <website>?". Access covers
  only the websites allowed in that session. When you move to another website, the panel asks again. Pause stops new
  commands. Revoke forgets every allowed website.
- **Owner only.** Only the agent's owner is offered access. Collaborators and public chatters never are. Public agents
  never get the browser, and making an agent public closes any open connection.
- **Owner-started turns only.** The agent server runs a browser command only inside an interactive turn that the
  connected owner started by sending a message. Triggers, delegated and child sessions, workflows, retries and
  continuations cannot use the browser.
- **Enforced in Electron.** The main process keeps the allowed websites on the grant. It refuses a command when the page
  is on any other website, both before and after the page script runs.
- **Asking before leaving.** When the agent wants to open a website you have not allowed, the panel shows Allow and Deny
  before any request is made. Redirects are checked the same way.
- **No private networks.** Agent navigation refuses loopback, private, link-local and `.local` addresses, including
  hostnames that resolve to them. Commands are also refused on a page whose main response came from a private address
  behind a public hostname (DNS rebinding). A website you opened at a literal local address, like
  `http://127.0.0.1:3000`, can still be allowed by hand.

## Discovery and actions

Discover the tool with `read ~/tools/browser`, then invoke `call` with `tool: "browser"` and an `input` object:

- `snapshot` reads the text a person can see, source metadata, viewport information and interactive element references.
  Transparent, clipped, off-page and tiny text is left out.
- `screenshot` returns the page viewport to a vision-capable model.
- `click`, `type`, `press` and `scroll` interact with the page. Typing into password and other secret fields is refused,
  and so is typing into or submitting a form that posts to another website.
- `navigate` opens an HTTP(S) URL on an allowed website, or asks the user first. Agents cannot open Seed links; the user
  opens those.
- `archive` creates an editable desktop draft and saves a Markdown copy in the owner-only `~/memory/private/browser/`
  folder. Images are fetched once and stored locally, so the draft never loads the source site.

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
- Websites get no permissions except clipboard writes confirmed after a click. They never auto-select a client
  certificate, and can only download after a click, with a save dialog.
- A page can only switch the app to a Seed page or open a popup right after real user input, and never while an agent
  command runs.
- Favicons and archived images are read with a size cap and must be images.
- Settings has **Clear browsing data** for the browser's own session.

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
