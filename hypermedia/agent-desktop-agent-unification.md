---
name: "Desktop agent unification"
summary: "Replacing the desktop's separate assistant runtime with the Agents service, running locally as a subprocess of the desktop app. One agent runtime, one…"
---
> **STATUS (2026-08-13): the unification finished. Most of the "Not done" list below has since landed.**
>
> Verified against the tree today: the old stack is **deleted** (`app-chat.ts` and `app-ai-config.ts` no longer exist,
> and nothing reads `chat-sessions/*.json`); CI sets up Bun and builds the agents binary per runner, and
> `forge.config.ts` signs it through `osxSign.binaries`; the window-context message part shipped
> (`MessageSessionContentPart` `{type: 'context', lines}`, sent by the desktop). ChatGPT/Codex OAuth reaches the service
> as a provider type.
>
> **Still open from that list:** auto-provisioning a built-in `Assistant` agent for fresh installs, and running the
> Linux/Windows binaries — `desktop-smoke-test.yml` builds and runs on macOS only, and there is no
> `scripts/smoke-build.ts`.
>
> Everything else in this document is a current description of how the desktop and the service fit together.

Replacing the desktop's separate assistant runtime with the Agents service, running locally as a subprocess of the
desktop app. One agent runtime, one protocol, one UI — local and hosted alike.

Companion planning docs live at `docs/plans/agent-unification.md` (full plan, packaging, deletion inventory) and
`docs/plans/pi-chatgpt-oauth.md` (ChatGPT/Codex sign-in). This document is the agents-side view: what changed in this
service and why.

## The problem

The desktop shipped two complete AI stacks. The assistant sidebar had its own runtime (Vercel AI SDK `streamText`), its
own persistence (`chat-sessions/*.json`, rewritten whole on every message), its own provider config with its own secret
storage, and its own four tools. The Agents service had durable event-log sessions, signed CBOR + WebSocket transport,
encrypted secrets, nine provider types, triggers, and eight tools. Two implementations of the same product idea, one
strictly worse, both needing every future feature built twice.

The Agents service is a superset. So the sidebar should be a _view over an agent session_, not a second runtime.

## Why a local server is possible

The unlock is that the desktop app **already serves the typed HTTP API this service consumes**.
`frontend/apps/desktop/src/app-http-server.ts` runs `@shm/shared/api-server` on `localhost:56004`, backed by the user's
own daemon over gRPC. That is the same `/api/<Key>` protocol `createSeedClient(baseUrl)` speaks. Direct IPFS gateway
reads are not part of that bridge: `/ipfs/<cid>` remains on the daemon at `localhost:56001`. File publication is
portable: the agents service chunks UnixFS blocks itself and sends them through the bridge's `PublishBlobs` action.

So a locally spawned agent server uses both `--hm-server-url=http://localhost:56004` and
`--ipfs-server-url=http://localhost:56001`. Typed reads/writes and file traffic take their correct transports to the
same user-owned node, with no public gateway involved.

This was verified against a live desktop before any code was written, via `agents/scripts/smoke-local-hm.ts`:

```
$ bun scripts/smoke-local-hm.ts
  ok    Search (backs the `search` tool)                    30 entities
  ok    ListEvents (backs `list_activity_feed` + triggers)  5 events
  ok    ListAccounts (resolves authors)                     259 accounts
  ok    Resource (backs the `read` tool)                    hm://…/tags/seedweb -> type=document
```

Keep that script working. It is the cheapest possible check that the local topology is still sound, and it needs nothing
but a running desktop app.

## Topology

```text
Electron main process
  ├─ Go daemon subprocess              (unchanged)
  ├─ Local HM API server :56004        (typed /api/* bridge)
  ├─ Go daemon HTTP :56001              (direct /ipfs/* gateway reads)
  └─ seed-agents subprocess :3050+      (the same artifact the Docker image runs)
        --hm-server-url=http://localhost:56004
        --ipfs-server-url=http://localhost:56001
        --db-path=<userData>/agents/agents.sqlite

Renderer
  ├─ Agents pages (list / detail / session)   unchanged
  └─ Assistant sidebar                        a session view over any agent on any server
```

The local server is registered as one more entry in the existing multi-server list, so hosted servers keep working side
by side. Same protocol, same signing, same UI.

## Dev attaches, packaged spawns

The desktop does **not** unconditionally spawn a server. `frontend/apps/desktop/src/agents-server-process.ts` resolves
in this order:

1. `SEED_NO_AGENTS_SPAWN` — skip entirely; the desktop only talks to configured remote servers.
2. `SEED_AGENTS_SERVER_URL` — attach to an explicitly configured server, failing loudly if it is unhealthy.
3. A healthy agents server already answering on the default port — attach.
4. Otherwise spawn the bundled binary on the first free port.

Rule 3 is the important one. `./dev up` already runs `cd agents && bun run dev` with `bun --hot` in its own mprocs pane.
Spawning a second server there would fight it for the port and silently shadow the developer's edits. Probing first
means **editing agent server code hot-reloads exactly as it always has**, with no flag anyone has to remember.

Health is probed at `/agents/api/health` and must return `status: 'ok'`, so an unrelated process squatting on 3050 does
not get mistaken for an agents server.

## Packaging notes

The server ships as a `bun build --compile` binary, spawned like the Go daemon
(`frontend/apps/desktop/src/agents-server-path.ts` mirrors `daemon-path.ts`). Verified: builds for all five platform
triples, serves health/status/inspector UI, and the darwin-x64 build runs under Rosetta.

Two things that will bite if forgotten:

- **`package.json` must sit next to the binary.** `pi-coding-agent` does `readFileSync(getPackageJsonPath())` at import
  time, resolved against `cwd`. Without it the process exits immediately with `ENOENT`. `agents/Dockerfile` already
  relies on this arrangement; the desktop spawn sets `cwd` to the binary's directory for the same reason.
- **macOS signing.** The binary must be added to `osxSign.binaries` in `forge.config.ts` alongside the daemon, or
  notarization ships an unsigned nested executable. The existing `entitlements.plist` already grants
  `com.apple.security.cs.allow-jit`, which Bun's JIT needs and the Go daemon did not.

CI also needs Bun added to `.github/actions/ci-setup`, which currently installs Go, pnpm, Node, and Vulkan only.

## What changed in this service

### `ListSessions`

New signed action (see [Signed API](./agent-signed-api.md)). Lists an account's sessions newest-first across every agent on
the server, returning the referenced agents alongside them.

The sidebar shows one merged list spanning every agent on every configured server. Without this action the client would
have to call `ListAgents` and then `GetAgent` per agent just to enumerate sessions — an N+1 per server, on a 5-second
refetch.

Pagination is keyset on the composite `(updated_at, id)`. This is not incidental: sessions regularly share an
`updated_at` millisecond because one trigger firing over a batch of activity events creates several at once. A
timestamp-only cursor silently drops every tied row past a page boundary — measured at **3 of 5 sessions lost** in the
regression test (`paginates sessions that share an updated_at millisecond without losing rows`), which fails against the
timestamp-only implementation and passes against the composite one.

## What the desktop side looks like now

- `agents-server-path.ts` / `agents-server-process.ts` — binary resolution and spawn/attach lifecycle.
- `models/agents.ts` — `useLocalAgentServerUrl()` reports the running local server; `useAgentServerUrls()` prepends it
  to the configured list; `useAllAgentSessions()` fans `ListSessions` out across servers and merges newest-first.
  Per-server failures are isolated, so an unreachable hosted server cannot blank the list the local one populates.
- `models/agent-session-rows.ts` — the durable-event → chat-row transform, extracted from the Agents session page so the
  sidebar renders identical transcripts from the same code. Pure, React-free, and unit-tested.
- `components/assistant-panel.tsx` — rewritten as a session view: a picker over all sessions from all servers, and a
  new-chat dialog listing every agent on every server. The local server is labeled "This computer".
- `components/assistant-session-ref.ts` — session ids are only unique _per server_, so the sidebar's selection is a
  `(serverUrl, sessionId)` pair. Window state persists a single string, so the pair is serialized; selections written by
  older builds (a bare session id) decode to null rather than querying a nonsensical server.

### Assistant entry-point gating

The footer's assistant controls are gated on `useHasAnyAgent()` — whether the account has at least one agent on any
configured server — not on server availability. The desktop always runs a local server, so "a server exists" is always
true and would leave the buttons visible with nothing to chat with. The old stack gated on "a model provider is
configured", which was its equivalent proxy for the same question.

While the agent lists are still resolving, the assistant counts as available: treating the in-flight state as empty
would hide the controls on every launch and discard the restored sidebar state. `main-assistant-visibility.test.tsx`
covers both the empty and still-loading cases.

### Presenting the local server

It is labeled **Local Agents** everywhere (`LOCAL_AGENT_SERVER_LABEL`), never as a URL — its port is assigned at
startup, so the address is an implementation detail that changes between runs. On the Agents page it also carries no
status dot while healthy: an "online" indicator on a server that ships inside the app is noise. A _failing_ local server
still shows its dot, because that is a real problem the user needs to see.

`isLocalAgentServer()` / `describeAgentServer()` in `models/agents.ts` are the single source for this, so the Agents
page, settings, and the sidebar cannot drift apart on naming.

### Configured vs. effective server lists

`useConfiguredAgentServerUrls()` returns only what settings persists; `useAgentServerUrls()` returns the local server
followed by those. The split matters: the settings UI edits the persisted list, and merging the local server into it
would write a URL whose port is reassigned on every start, leaving a dead entry behind. The settings screen therefore
renders the local server from its own hook as a non-removable "This computer / Built-in" row, and the Agents page and
sidebar both consume the effective list so the local server is always present without any configuration.

### Dialog primitive pairing

`useAppDialog(Content)` mounts content inside a Radix `Dialog` root; `useAppDialog(Content, {isAlert: true})` uses an
`AlertDialog` root. Mixing the families throws at render — "`DialogTitle` must be used within `Dialog`" — and TypeScript
cannot catch it, because both title components have identical prop types. The new-chat picker is a plain dialog and the
delete confirmation is an alert dialog; `assistant-dialogs.test.tsx` mounts each in the root its call site actually
uses, and fails with that exact error if the pairing regresses.

## Status

Done:

- `ListSessions` action, service implementation, and tests (including the tied-timestamp regression).
- Local server lifecycle: spawn/attach, health gating, port selection, graceful shutdown, startup ordering behind the HM
  API server.
- Cross-server session model layer and the rewritten sidebar.
- Phase 0 validation script proving the local HM topology.

Not done — see `docs/plans/agent-unification.md` for the full sequence:

- CI/packaging: Bun in `ci-setup`, per-runner binary build, `osxSign.binaries`, `.exe` naming, missing-binary guard.
- Deleting the old stack (`app-chat.ts`, `app-ai-config.ts`, and friends — roughly 4,000 lines) once ChatGPT OAuth is
  reachable through a provider type. Pi already implements Codex OAuth; see `docs/plans/pi-chatgpt-oauth.md`.
- Auto-provisioning a built-in `Assistant` agent so a fresh install has something to talk to immediately. Until then, a
  server with no agents shows the new-chat picker's empty state pointing at the Agents page — agents cannot be created
  without a configured model provider, so there is nothing sensible to provision automatically yet.
- Window context (`{type: 'context'}` message part) and `navigate` executed client-side off the event stream.
- Migrating or archiving existing `chat-sessions/*.json`.
- Linux/Windows binaries have been compiled and format-verified but never _run_; `scripts/smoke-build.ts` should cover
  that in CI.
