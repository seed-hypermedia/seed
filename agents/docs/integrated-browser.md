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
  opens those.
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
- Websites get no permissions, never auto-select a client certificate, and can only download after a click, with a save
  dialog.
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
