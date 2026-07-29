# Agent Unification Plan

Replace the desktop's bespoke assistant stack with the Agents service, running locally as a subprocess of the desktop
app. One agent runtime, one protocol, one UI — everywhere.

Branch: `feat/agent-unification`

---

## 1. What exists today

Two complete, independent AI stacks:

| Concern         | Desktop assistant (`app-chat.ts`)                       | Agents service (`agents/`)                                |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Runtime         | Electron main process, Vercel AI SDK `streamText`       | Bun service, Pi SDK (`@mariozechner/pi-coding-agent`)      |
| Persistence     | `chat-sessions/*.json` files, whole-session rewrite     | SQLite, append-only event log with `seq` replay            |
| Transport       | tRPC + `ipcMain` broadcast (`chatStreamEvent`)          | Signed DAG-CBOR `/api/message` + signed WebSocket          |
| Providers       | `app-ai-config.ts` (openai/anthropic/gemini/ollama)     | `SetModelProvider`/`SetSecret`, 9 provider types, AES-GCM  |
| Secrets         | Electron `safeStorage`                                  | AES-GCM, key in SQLite `server_config`                     |
| Tools           | `search`, `read`, `list_activity_feed`, `navigate`      | + `web_search`, `web_read`, `write`, `set_session_title`   |
| HM access       | `grpcClient` + `desktopRequest` (in-process)            | `createSeedClient(hmServerUrl)` over HTTP                  |
| Triggers        | none                                                    | activity + schedule triggers, poll loop, watermarks        |
| Multi-agent     | no — one implicit assistant                             | yes — named agents, system prompts, per-agent tool policy  |
| Stop/cancel     | yes (`AbortController`)                                 | yes (`StopSession`)                                        |
| Usage/activity  | no                                                      | yes (`AgentRunUsage`, `AgentRunActivity` over WS)          |
| Rendering       | `assistant-message-rendering.tsx` — **already shared**   | same                                                        |
| Tool schemas    | `seedToolRegistry` — **already shared**                  | same                                                        |

The Agents service is a strict superset of the assistant except for four things (§6).

## 2. Key findings

These are the findings that make this tractable — each was verified against the code, not assumed.

**F1 — The desktop already exposes the exact HTTP API the agent service consumes.**
`frontend/apps/desktop/src/app-http-server.ts` serves `@shm/shared/api-server`'s `handleApiRequest`/`handleApiAction`
on `localhost:56004` (`API_HTTP_PORT`), backed by the local daemon via `grpcClient`. That is the same `/api/<Key>`
protocol `createSeedClient(baseUrl)` speaks (`frontend/packages/client/src/client.ts:155`), including `Search`,
`ListEvents`, `Resource`, `PublishBlobs`, and `PrepareDocumentChange`. **A local agent server pointed at
`--hm-server-url=http://localhost:56004` gets full read *and* write access to the user's own node with zero new
plumbing.** This is the single biggest unlock.

**F2 — The agent server compiles to a standalone binary today.** Verified end-to-end (§10): `bun build --compile`
produces an 80 MB single-file binary that serves `/agents/api/health`, `/agents/api/status`, and the embedded inspector
UI. All four cross-targets build correctly too. For scale, the app already ships a 201 MB `seed-daemon`, and
`daemon.ts`/`daemon-path.ts` are a ready-made pattern for spawning a per-platform binary from `process.resourcesPath`.

**F3 — The Bun coupling is shallow.** Across ~11k lines of `agents/src`, Bun-specific usage is: `bun:sqlite` (only
`db.run`, `db.query`, `db.transaction`, `db.close`), `Bun.serve` routes in `main.ts`, `Bun.file`, and
`import.meta.main`. So a Node port stays a live option if we ever want in-process execution, but it is not needed to
unify.

**F4 — The tool registry already models the split.** `agents/protocol/src/tool-registry.ts` tags every tool with
`runtimes: ('assistant' | 'agent-service')[]`. Only `navigate` is assistant-only. So "which tools does a local agent
get" is already a first-class, declarative concept.

**F5 — `navigate` does not need a callback channel.** The desktop is already a live WebSocket subscriber to every
session. When a `tool_call` for `navigate` arrives, the desktop can execute the navigation itself from the event
stream; the server returns "navigation requested" to the model immediately. No reverse RPC, no port negotiation.

## 3. Target architecture

```text
Electron main process
  ├─ Go daemon subprocess            (unchanged)
  ├─ Local HM API server :56004      (unchanged — becomes the agent's HM backend)
  └─ seed-agents subprocess :3050    (NEW: same binary as the Docker image)
        --hm-server-url=http://localhost:56004
        --db-path=<userData>/agents/agents.sqlite

Renderer
  ├─ Agents pages (list/detail/session)   ← existing, unchanged
  └─ Assistant sidebar panel              ← rewritten as a thin wrapper over the
                                            same session UI, bound to a built-in
                                            local "Assistant" agent
```

The local server is just another entry in the existing multi-server list (`useAgentServerUrls`), flagged as built-in.
Users keep the hosted `agentic.seed.hyper.media` alongside it. Same protocol, same client, same UI, same signing.

The sidebar assistant becomes: *a session view on the local server's auto-provisioned `Assistant` agent.*

## 4. Decisions

### D1 — Ship the compiled Bun binary as a subprocess (recommended)

| Option                                                 | Cost                                                                        | Verdict                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| **A. `bun build --compile` binary, spawned like daemon** | +80 MB/platform in installer; CI cross-compile step                          | **Recommended.** Zero divergence, proven (F2). |
| B. Port to Node, run in Electron main via `utilityProcess` | sqlite adapter + `Bun.serve`→`node:http`+`ws` port; must keep Docker working | Possible later (F3); not worth blocking on.   |
| C. Bundle Bun runtime + JS                             | same size, more moving parts than A                                          | No.                                           |

A means the desktop runs *literally the same artifact* as production. Any behavior difference between local and hosted
agents becomes a config difference, not a code difference — which is the whole point of the unification.

### D2 — Auto-provision one built-in `Assistant` agent per account

On first run against the local server, create an agent named `Assistant` with `seedAssistantSystemPrompt({
includeTitleToolInstruction: true })` and the desktop tool set. The sidebar always targets it. Users can still edit it
from the Agents page — it is a normal agent, not a special case in the data model.

### D3 — Carry window context as a typed message part

The current assistant injects "## Current window" into the system prompt per message
(`app-chat.ts:811-844`). `MessageSessionContentPart` is currently `{type: 'text', text, blocks?}`. Add
`{type: 'context', lines: string[]}`: the service appends it to that turn's system prompt, and the UI hides it from the
transcript. Small, additive protocol change; keeps context out of the visible conversation.

### D4 — `navigate` runs client-side off the event stream

Per F5. `assistant-navigation.ts` stays; its caller changes from a tool executor to a WebSocket event handler. Add
`navigate` to `runtimes` with a server-side stub that records intent.

### D5 — Local writes sign as the user (deferred to phase 4)

Hosted agents write via server-held signing identities. A local agent should be able to write as *you*. The local
daemon can sign (`grpcClient.daemon.signData`), so the local server can be given a signing bridge. Deferred — phase 1
uses the existing signing-identity flow so nothing blocks on it. See Q3.

## 5. Phases

**Phase 0 — Prove the loop (no packaging).** Run `bun run dev` in `agents/` with `--hm-server-url=http://localhost:56004`
against a running desktop. Confirm `read`, `search`, `list_activity_feed`, and `write` all work against the local node.
This validates F1 end-to-end before any code is written. *Deliverable: findings note, no code.*

**Phase 1 — Packaging.** `bun build --compile` in CI for all 5 platform triples; ship to `resourcesPath` alongside
`seed-daemon` (+ the `package.json` from F2). New `agents-process.ts` modeled on `daemon.ts`: spawn, health-poll,
log-pipe, graceful shutdown, port selection. Register `http://localhost:<port>` as a built-in server URL.

**Phase 2 — Sidebar swap.** Auto-provision the `Assistant` agent (D2). Rewrite `assistant-panel.tsx` as a wrapper over
the session view already used by `pages/agents/session.tsx` — extracting the shared chat surface from that 977-line
page into a reusable component. Wire context (D3) and navigate (D4). Keep `chat-message-composer.tsx` and
`chat-message-queue.tsx`.

**Phase 3 — Delete.** Remove the old stack (§7) once the sidebar is on the new path. Drop `@ai-sdk/*` + `ai` deps.

**Phase 4 — Reach parity and beyond.** ChatGPT OAuth provider (§6), local signing (D5), then the features the sidebar
gets *for free* on day one: triggers, usage/cost display, multi-agent, `web_search`/`web_read`, stop, durable replay.

## 6. Parity gaps to close

1. **ChatGPT OAuth login.** ~~The one genuine feature gap.~~ **Downgraded after research — see
   [pi-chatgpt-oauth.md](./pi-chatgpt-oauth.md).** Pi already ships `openaiCodexOAuthProvider` (login, refresh,
   `chatgpt-account-id` header, `instructions`/`store:false` Responses semantics — everything
   `chat-provider-options.ts` hand-rolls). The agents service simply never wires pi's OAuth layer to its provider
   model: ~1 provider type + 3 protocol actions. Pi's login is loopback-only (`localhost:1455`), which is fine for the
   **local** server, so this no longer blocks phase 3. Device-auth login — which our `app-ai-config.ts` already
   implements and pi lacks — is needed only for the **hosted** server, and is a clean upstream contribution.
2. **Secret storage strength.** Old path uses Electron `safeStorage` (OS keychain); the agent server uses AES-GCM with
   the key in SQLite next to the ciphertext. For a local server on the user's own disk this is a real downgrade. Fix:
   have the desktop supply the encryption key from `safeStorage` at spawn time.
3. **Session migration.** Existing `chat-sessions/*.json` need importing into the local SQLite or an explicit
   "old chats are archived" decision.
4. **Icon upload.** `uploadIconToHmNode` POSTs to `<hmServerUrl>/ipfs/file-upload`, which the local API server on
   :56004 does not serve (the daemon does, on its own port). Needs a proxy route or a separate flag.

## 7. Deletion inventory

Removed outright:

| File                                        | LOC   |
| ------------------------------------------- | ----- |
| `src/app-chat.ts`                           | 1004  |
| `src/app-ai-config.ts`                      | 1138  |
| `src/models/ai-config.ts`                   | 215   |
| `src/models/chat.ts`                        | 163   |
| `src/models/chat-parts.ts`                  | 110   |
| `src/chat-search.ts`                        | 155   |
| `src/openai-models.ts`                      | 64    |
| `src/chat-provider-options.ts`              | 39    |
| `src/chat-stream-error.ts`                  | 33    |
| **subtotal**                                | **2921** |

Tests deleted with them: `app-ai-config.test.ts` (162), `assistant-providers-settings.test.tsx` (666),
`chat-search.test.ts` (119), `chat-parts.test.ts` (66), `chat-provider-options.test.ts` (48),
`openai-models.test.ts` (38), `chat-stream-error.test.ts` (30) — **1129**.

Shrunk substantially: `components/assistant-panel.tsx` (521 → ~120), the "Agent Assistant Providers" section of
`pages/settings.tsx` (~300 → 0, subsumed by the Agents server provider dialog), `app-api.ts` chat router wiring,
plus rewrites of `assistant-panel.test.tsx` (534) and `main-assistant-visibility.test.tsx` (447).

Dependencies dropped from `@shm/desktop`: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` — the entire
Vercel AI SDK, used nowhere else in the app.

**Net: ~4,800–5,300 lines deleted against roughly 600 added.**

## 8. Open questions

- **Q1 — Local server lifetime.** Only while the app is open, or a background service that keeps triggers firing?
  Triggers are much of the value, and they need the daemon anyway. Recommend app-lifetime for phase 1.
- **Q2 — Multiple windows/accounts.** One local server, many accounts (the protocol is already account-scoped) — but
  confirm the singleton spawn survives multi-window and account switching.
- **Q3 — Should local agents write as the user?** (D5) It is the natural expectation for a sidebar assistant and the
  reason `docs/desktop-assistant-write-plan.md` exists — including its approve/deny confirmation UX, which would now
  need to live in the shared session UI rather than the old chat path.
- **Q4 — Installer size.** +80 MB/platform on top of the existing 201 MB daemon. Acceptable?
- **Q5 — `web_search`/`web_read` locally.** They need SearXNG/Crawl4AI backends. Point local agents at the hosted
  backends, or leave those tools off locally?

## 9. Environments, dev loop, and packaging — verified

Everything in this section was tested, not assumed. Commands and outputs are reproducible from `agents/`.

### 9.1 Does the compiled binary actually work?

Yes — but **only with `package.json` next to it**. First run crashed: `pi-coding-agent`'s `config.js` does
`readFileSync(getPackageJsonPath())` at import time, resolved against `cwd`. With the file alongside and `cwd` set to
that directory, verified working:

```
$ ./seed-agents --server-port=3099 --db-path=... --data-dir=...
{"status":"ok","uptime":3.2,"version":"dev","hmServerUrl":"https://hyper.media","webTools":{...}}
```

`/agents/api/status` → 200, and `/agents` serves the embedded inspector HTML (449 B, correct doctype) — so the
`import index from '@/frontend/index.html'` bundling survives `--compile`. No stray files written to `cwd` beyond the
SQLite paths given by flags (use absolute paths under `userData`). The Dockerfile already does exactly this
`package.json`-alongside trick, so we are matching a proven layout.

### 9.2 Cross-platform

Cross-compiled from darwin/arm64; `file` confirms all four are genuine native binaries:

| Target             | Size   | `file` output                       |
| ------------------ | ------ | ----------------------------------- |
| bun-darwin-arm64   | 80 MB  | Mach-O 64-bit arm64 (host build)    |
| bun-darwin-x64     | 74 MB  | Mach-O 64-bit x86_64                |
| bun-linux-x64      | 112 MB | ELF 64-bit x86-64, glibc            |
| bun-linux-arm64    | 109 MB | ELF 64-bit ARM aarch64, glibc       |
| bun-windows-x64    | 123 MB | PE32+ console x86-64                |

The darwin-x64 binary was additionally *executed* under Rosetta and returned a healthy `/agents/api/health` — so these
are functional, not just well-formed. **We likely do not need cross-compilation at all**: the release matrix already
builds the Go daemon natively on ubuntu/macos/windows runners, so each runner can build its own agents binary.
Cross-compile is the fallback.

Specific concerns, checked:

- **macOS hardened runtime + JIT.** Bun uses JavaScriptCore; the Go daemon does not JIT, so this was the risk I most
  expected to bite. `entitlements.plist` **already** grants `com.apple.security.cs.allow-jit`,
  `allow-unsigned-executable-memory`, and `disable-library-validation`. Nothing to change.
- **macOS signing — action required.** `forge.config.ts:375` lists `osxSign.binaries: [daemonBinaryPath]`. The agents
  binary **must** be added, or notarization ships an unsigned nested executable that won't launch on other Macs.
- **Windows.** Needs the `.exe` suffix handled like `DAEMON_NAME` already is (release workflow passes
  `DAEMON_NAME: '<triple>.exe'`). Squirrel packaging itself is agnostic.
- **Linux.** The ELF is dynamically linked against glibc — fine for deb/rpm/AppImage, would fail on musl/Alpine. Worth
  a note in the flatpak build (`test-flatpak-build.sh`).
- **Missing-binary guard.** `forge.config.ts:49` throws in CI when the Windows DLL is absent. Mirror that for the
  agents binary so a missing build fails loudly instead of shipping a broken app.

### 9.3 Dev loop — hot reload already exists

**Yes, editing agent server code hot-reloads, and no new mechanism is needed.** `mprocs.yaml` (`./dev up`) already runs
the agents server as its own pane:

```yaml
agents:
  shell: 'cd agents && bun run dev'   # watch-file-deps.ts + bun --hot src/main.ts
```

`bun --hot` re-evaluates on save and `watch-file-deps.ts` re-syncs the `file:` deps (`frontend/packages/*`) so they
never go stale. Sessions live in SQLite so they survive a reload, and the desktop's WebSocket client already has
exponential-backoff reconnect (`models/agents.ts:1024`).

So the rule is: **dev attaches, packaged spawns.**

- `./dev up` — desktop does *not* spawn the binary; it attaches to the mprocs-run server on :3050. Hot reload intact.
- Packaged — desktop spawns the compiled binary from `resourcesPath`.

There is already a precedent for exactly this toggle: `SEED_NO_DAEMON_SPAWN` (`daemon.ts:245`) makes the desktop skip
spawning the Go daemon and use externally-provided ports. Add `SEED_NO_AGENTS_SPAWN` the same way, defaulted on in the
mprocs `desktop` pane. Better still, make it automatic: probe `/agents/api/health` on the configured port first and
attach if something healthy answers, spawn otherwise — that removes a whole class of "two servers fighting over :3050"
confusion.

### 9.4 CI — action required

**Bun is not installed in the desktop pipeline.** `.github/actions/ci-setup/action.yml` installs Go, pnpm, Node 22,
Vulkan, and llama.cpp — no Bun. (`release-desktop.yml` matches `bun` only inside the word "u*bun*tu".) Needs
`oven-sh/setup-bun@v2` added to `ci-setup`, plus a build step per runner mirroring the existing daemon build steps, and
the artifact added to the Sentry symbol upload list alongside `seed-daemon-*`.

The Docker path (`release-docker-images.yml`, `hotfix-agents-image.yml`) is untouched — it keeps using
`agents/Dockerfile` and `bun run build`, not `--compile`.

### 9.5 Net answer

| Question                                  | Answer                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Works in dev?                             | Yes — attach to the existing `bun --hot` mprocs pane, unchanged.           |
| Hot reload on agent-code edits?           | Yes, already how `./dev up` works today.                                   |
| Production binary actually working?       | Verified: health, status, inspector UI — with `package.json` alongside.    |
| Cross-platform?                           | All 4 targets build; x64 darwin executed OK. CI builds natively per-runner. |
| Blocking work?                            | 3 items: `osxSign.binaries`, Bun in `ci-setup`, `.exe` naming.             |

## 10. Risks

- **Startup ordering.** The agent server needs the local API server, which needs the daemon. A three-stage boot with
  health gates; the agent process must tolerate its HM backend being briefly absent.
- **Port collisions.** :3050 may be taken (including by a dev instance). Needs dynamic port selection reported back to
  the renderer, like `local-server.ts` already does.
- **Runtime verification on Linux and Windows.** All targets compile and darwin x64/arm64 were executed successfully, but the linux and windows binaries have not been *run* — only format-verified. Needs a CI smoke test (`agents/scripts/smoke-build.ts` already exists for this).
- **Bundling `agents/` in CI.** It is a Bun workspace deliberately isolated from the pnpm workspaces
  (`agents/AGENTS.md`); the desktop build must invoke it without violating that boundary.
