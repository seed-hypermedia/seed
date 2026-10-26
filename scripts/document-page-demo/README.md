# Document page sandbox prototype

A local workshop for agent-created pages. This is a standalone experiment, not the production web renderer or the
existing desktop `seed-page://` implementation. It uses sample identities and documents; it never connects to the Seed
daemon. Alice/Bob switching demonstrates storage namespaces, not real authentication.

## Run

From the Seed repository, with its normal dependencies installed:

```sh
direnv exec . pnpm page-demo
```

Open **http://127.0.0.1:53110**. The static runner listens on **http://127.0.0.1:53111**. Both bind exclusively to
loopback. Use the exact `127.0.0.1` URL; Host validation deliberately rejects other hostnames. Stop with Ctrl-C.
Override ports with `DEMO_PORT` and `DEMO_RUNNER_PORT` if necessary.

The saved **Field Notes** page was created by a real local Codex run, then repaired by the agent after a browser test
found an unsupported form-submit handler. It opens without an agent login or a network request to a model. The saved
artifact includes the original request, source HTML, creation timestamp, and SHA-256 revision in `example.json`.

To create a new page, sign in to the local CLI once:

```sh
direnv exec . codex login
```

Enter a request and click **Create page**. This launches a real `codex exec` job using that sign-in; model usage
applies. The server passes the runtime contract and your prompt, not notebook contents or sample documents. The job runs
in an ephemeral temporary directory, in read-only mode, with user configuration, shell tools, and web search disabled.
It returns a structured artifact rather than editing the repository. Creation has a five-minute deadline; Cancel aborts
the job. This is a local development adapter, not a remotely accessible agent execution service. See
[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

Generated page artifacts are saved under the gitignored `tmp/document-page-demo/`. Page state is in this browser's local
storage on the **parent** origin. Clearing that site's data resets notes; restarting the server preserves them. Using
another browser or port starts with separate browser state. Nothing syncs yet.

## Walk through the demo

1. As Alice, add a note. **Reload page**; the note returns.
2. Switch to Bob; Alice's note is absent. Switch back; it returns.
3. Enable **Open a separate copy**. It runs the same code under another page identity, with empty storage.
4. Click **Read project brief** in the page. It is denied. Enable **Share sample project brief** in the parent and read
   again. Only that document is allowed. Disable the grant to revoke it and restart the page instance.
5. **Simulate a code update**. Storage survives, but the document grant is gone. The simulated revision is in-memory;
   refreshing the entire workshop returns to the saved artifact.
6. Select **Signed out**. Every active page frame/channel is destroyed.
7. Click **Run boundary checks** for nine probes in your current browser. Expand **Bridge activity** to see allowed and
   denied API calls without their contents.
8. Ask the agent for a different page. It receives the same restricted API contract and opens in the same sandbox.

Example request: “Make a reading journal with book title, finished checkbox, and a one-line thought. Save my books
between visits. Include a button to read the shared project brief.”

## Automated checks

Install the browser engines once:

```sh
direnv exec . pnpm exec playwright install chromium firefox webkit
direnv exec . pnpm page-demo:test
```

The test command starts/stops its own servers on free ports; leave the interactive demo open. It uses the saved
agent-created page and never starts a model job. To run one engine:

```sh
direnv exec . env DEMO_BROWSERS=chromium pnpm page-demo:test
```

The suite exercises note persistence, page/account isolation, explicit document grants, revocation on updates/logout,
parent/sibling DOM access, native storage/cookies, worker and fetch blocking, direct runner visits, request bounds,
forged window messages, in-flight read revocation, mobile layout, HTTP sandbox headers, and generation endpoint
Origin/token/Host checks. WebKit is Playwright's engine, not a claim that shipping Safari has been certified.

It also includes a **passing test of a known limitation**: an opaque iframe can navigate itself to the local `/sink`
endpoint and include a harmless marker in the URL. This proves that blocking `fetch` does not prove zero data leakage.
That endpoint is a local measurement fixture, not a proposed production API.

## Runtime design

- The parent fetches a bundle and pins its revision. It creates an iframe with `sandbox="allow-scripts"` and sends code
  over a one-time MessageChannel after checking the exact frame, launch nonce, and opaque sender origin.
- The static runner additionally sends HTTP `Content-Security-Policy: sandbox allow-scripts`, with restrictive resource
  directives. No `allow-same-origin`. Direct visits retain the sandbox. The runner has no page catalog, private asset
  API, cookies, or mutable page state.
- `window.seed.context()`, `seed.storage.get/set`, and `seed.resource(id)` are asynchronous. Storage is scoped by the
  parent to `(viewer, page identity)`, with 64 keys, 128-character keys, and 16 KiB values. Pages cannot choose a viewer
  or namespace. Requests are bounded to 64 KiB and 100 per second per instance; the client permits 32 pending calls.
- Only explicitly granted sample resources are readable, and grants are keyed to `(viewer, page, revision)`. No document
  writes, directory-wide reads, arbitrary HTTP proxy, or access to the local authoring agent.
- A new frame/channel replaces the old one on page/account/revision/grant changes. The host drops late results after
  revocation. Page navigation closes the channel, but cannot retract requests/data already sent or disclosed.
- Pages are self-contained HTML with inline styles and classic scripts. They use buttons/click handlers rather than HTML
  form submission (Chromium/Firefox suppress submission events without `allow-forms`). No runtime imports, CDN
  dependencies, native persistent storage, service workers, or arbitrary file trees in this first prototype.

## Limits and next integration work

This is not a production security certification or a guarantee that private data cannot leave page code. Giving code
data is disclosure. Navigation is an established exception; CPU/memory exhaustion is also not isolated by this demo. Two
loopback ports demonstrate different origins, but not different registrable sites or production process isolation.

The integrated implementation uses a same-host opaque web runner and a dedicated desktop protocol. It includes viewer
authorization, signed document/bundle resolution, scoped permissions and agent publication. See
[custom HTML pages](../../hypermedia/apps/document-pages.md) for its current SDK and deployment model; a separate web
runner domain is not required. This workshop retains its earlier two-port design to exercise isolation independently.

The workshop's local browser state is not encrypted or synced. Updates retain storage, so a newly authorized code
version can read prior page state; revoking a document grant cannot erase copies an earlier version already saved. Its
sample SDK is separate from the integrated page SDK and does not demonstrate schema-defined URL input.

Source responsibilities:

- `server.mjs`: loopback servers, headers, generation boundary and saved artifacts.
- `agent.mjs`: actual Codex job, page-author contract, artifact validation/revision.
- `runner.js`: opaque runtime, page DOM/script loading, narrow client API.
- `bridge.js`: parent-owned session, storage, grants and lifecycle.
- `host.*`, `styles.css`: workshop interface.
- `checks.js`, `demo.test.mjs`: interactive probes and real-browser regression tests.
