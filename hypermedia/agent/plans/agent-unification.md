---
name: Agent Unification Plan
summary: The July 2026 plan that replaced the desktop app's separate assistant with the Agents service running as a local subprocess, kept as a historical record of the decisions and their reasons.
---
Status: historical record, July 2026. The unification it describes shipped: the desktop app embeds the agents server and there is one agent runtime, one protocol and one UI. Read the [system overview](../system-overview.md) and [desktop and web UI](../desktop-ui.md) for how things are today; the [roadmap](../roadmap.md) is the only live forward-looking page. <!-- id:2sdHpRSG -->

Replace the desktop's bespoke assistant stack with the Agents service, running locally as a subprocess of the desktop app. One agent runtime, one protocol, one UI — everywhere. <!-- id:l7yPy1uK -->

Branch: `feat/agent-unification` <!-- id:c0WQn503 -->

\--- <!-- id:lDqruwIQ -->

# 1. What exists today <!-- id:e782gl9p -->

Two complete, independent AI stacks: <!-- id:_zHP0qRI -->

<!-- id:2jKTHxXx -->
| Concern <!-- col:lW4gIBlf --> | Desktop assistant (`app-chat.ts`) <!-- col:8pYR1wQ6 --> | Agents service (`agents/`) <!-- col:0ui9YUxn --> <!-- id:WpjZbMfK --> |
| --- | --- | --- |
| Runtime | Electron main process, Vercel AI SDK `streamText` | Bun service, Pi SDK (`@mariozechner/pi-coding-agent`) <!-- id:jqS7afe0 --> |
| Persistence | `chat-sessions/*.json` files, whole-session rewrite | SQLite, append-only event log with `seq` replay <!-- id:9HZ152Kx --> |
| Transport | tRPC + `ipcMain` broadcast (`chatStreamEvent`) | Signed DAG-CBOR `/api/message` + signed WebSocket <!-- id:N9fqCoCE --> |
| Providers | `app-ai-config.ts` (openai/anthropic/gemini/ollama) | `SetModelProvider`/`SetSecret`, 9 provider types, AES-GCM <!-- id:lCe7PTLh --> |
| Secrets | Electron `safeStorage` | AES-GCM, key in SQLite `server_config` <!-- id:xnqKqf3s --> |
| Tools | `search`, `read`, `list_activity_feed`, `navigate` | + `web_search`, `web_read`, `write`, `set_session_title` <!-- id:YmDaKOOn --> |
| HM access | `grpcClient` + `desktopRequest` (in-process) | `createSeedClient(hmServerUrl)` over HTTP <!-- id:Z0Vjq7Ov --> |
| Triggers | none | activity + schedule triggers, poll loop, watermarks <!-- id:fTgLlPFI --> |
| Multi-agent | no — one implicit assistant | yes — named agents, system prompts, per-agent tool policy <!-- id:h3diEo_m --> |
| Stop/cancel | yes (`AbortController`) | yes (`StopSession`) <!-- id:_1bEqn57 --> |
| Usage/activity | no | yes (`AgentRunUsage`, `AgentRunActivity` over WS) <!-- id:hYsNlR3q --> |
| Rendering | `assistant-message-rendering.tsx` — **already shared** | same <!-- id:GAFw8yY0 --> |
| Tool schemas | `seedToolRegistry` — **already shared** | same <!-- id:FHCy8BqO --> |

The Agents service is a strict superset of the assistant except for four things (§6). <!-- id:nu6g3sae -->

# 2. Key findings <!-- id:07ey5AkI -->

These are the findings that make this tractable — each was verified against the code, not assumed. <!-- id:Keu-4Vic -->

**F1 — The desktop already exposes the exact HTTP API the agent service consumes.** `frontend/apps/desktop/src/app-http-server.ts` serves `@shm/shared/api-server`'s `handleApiRequest`/`handleApiAction` on `localhost:56004` (`API_HTTP_PORT`), backed by the local daemon via `grpcClient`. That is the same `/api/<Key>` protocol `createSeedClient(baseUrl)` speaks (`frontend/packages/client/src/client.ts`), including `Search`, `ListEvents`, `Resource`, `PublishBlobs`, and `PrepareDocumentChange`. **A local agent server pointed at `--hm-server-url=http://localhost:56004` gets full read _and_ write access to the user's own node with zero new plumbing.** This is the single biggest unlock. <!-- id:kNm0UQdg -->

**F2 — The agent server compiles to a standalone binary today.** Verified end-to-end (§10): `bun build --compile` produces an 80 MB single-file binary that serves `/agents/api/health`, `/agents/api/status`, and the embedded inspector UI. All four cross-targets build correctly too. For scale, the app already ships a 201 MB `seed-daemon`, and `daemon.ts`/`daemon-path.ts` are a ready-made pattern for spawning a per-platform binary from `process.resourcesPath`. <!-- id:2R7N_q4a -->

**F3 — The Bun coupling is shallow.** Across \~11k lines of `agents/src`, Bun-specific usage is: `bun:sqlite` (only `db.run`, `db.query`, `db.transaction`, `db.close`), `Bun.serve` routes in `main.ts`, `Bun.file`, and `import.meta.main`. So a Node port stays a live option if we ever want in-process execution, but it is not needed to unify. <!-- id:AtVj2_ri -->

**F4 — The tool registry already models the split.** `agents/protocol/src/tool-registry.ts` tags every tool with `runtimes: ('assistant' | 'agent-service')[]`. Only `navigate` is assistant-only. So "which tools does a local agent get" is already a first-class, declarative concept. <!-- id:hDKri6_H -->

**F5 — `navigate` does not need a callback channel.** The desktop is already a live WebSocket subscriber to every session. When a `tool_call` for `navigate` arrives, the desktop can execute the navigation itself from the event stream; the server returns "navigation requested" to the model immediately. No reverse RPC, no port negotiation. <!-- id:b-xU2waw -->

# 3. Target architecture <!-- id:dCRFnCcv -->

```text <!-- id:r6arbHsc -->
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

The local server is just another entry in the existing multi-server list (`useAgentServerUrls`), flagged as built-in. Users keep the hosted `agentic.seed.hyper.media` alongside it. Same protocol, same client, same UI, same signing. <!-- id:mK3TX5jy -->

The sidebar assistant becomes: _a session view on the local server's auto-provisioned `Assistant` agent._ <!-- id:hFuutSoT -->

# 4. Decisions <!-- id:8iW-fL_L -->

## D1 — Ship the compiled Bun binary as a subprocess (recommended) <!-- id:JepNkxb0 -->

<!-- id:CsPceEpe -->
| Option <!-- col:izUvr4Hx --> | Cost <!-- col:VxoCagZG --> | Verdict <!-- col:7bLSF2dA --> <!-- id:JVRbzmc0 --> |
| --- | --- | --- |
| **A. `bun build --compile` binary, spawned like daemon** | +80 MB/platform in installer; CI cross-compile step | **Recommended.** Zero divergence, proven (F2). <!-- id:79xKawA- --> |
| B. Port to Node, run in Electron main via `utilityProcess` | sqlite adapter + `Bun.serve`→`node:http`+`ws` port; must keep Docker working | Possible later (F3); not worth blocking on. <!-- id:ymt98aFt --> |
| C. Bundle Bun runtime + JS | same size, more moving parts than A | No. <!-- id:G5K6wN0c --> |

A means the desktop runs _literally the same artifact_ as production. Any behavior difference between local and hosted agents becomes a config difference, not a code difference — which is the whole point of the unification. <!-- id:2t05Q3X1 -->

## D2 — Auto-provision one built-in `Assistant` agent per account <!-- id:i7s7U2eM -->

On first run against the local server, create an agent named `Assistant` with `seedAssistantSystemPrompt({ includeTitleToolInstruction: true })` and the desktop tool set. The sidebar always targets it. Users can still edit it from the Agents page — it is a normal agent, not a special case in the data model. <!-- id:7-iF4tJ4 -->

## D3 — Carry window context as a typed message part <!-- id:5lFtq5is -->

The current assistant injects "## Current window" into the system prompt per message (`app-chat.ts`). `MessageSessionContentPart` is currently `{type: 'text', text, blocks?}`. Add `{type: 'context', lines: string[]}`: the service appends it to that turn's system prompt, and the UI hides it from the transcript. Small, additive protocol change; keeps context out of the visible conversation. <!-- id:sVw_eTMo -->

## D4 — `navigate` runs client-side off the event stream <!-- id:u3JLfOl2 -->

Per F5. `assistant-navigation.ts` stays; its caller changes from a tool executor to a WebSocket event handler. Add `navigate` to `runtimes` with a server-side stub that records intent. <!-- id:deeQvoYG -->

## D5 — Local writes sign as the user (deferred to phase 4) <!-- id:YyYKU2_l -->

Hosted agents write via server-held signing identities. A local agent should be able to write as _you_. The local daemon can sign (`grpcClient.daemon.signData`), so the local server can be given a signing bridge. Deferred — phase 1 uses the existing signing-identity flow so nothing blocks on it. See Q3. <!-- id:rNN61Cju -->

# 5. Phases <!-- id:-lvUbaxR -->

**Phase 0 — Prove the loop (no packaging).** Run `bun run dev` in `agents/` with `--hm-server-url=http://localhost:56004` against a running desktop. Confirm `read`, `search`, `list_activity_feed`, and `write` all work against the local node. This validates F1 end-to-end before any code is written. _Deliverable: findings note, no code._ <!-- id:-K9DBal- -->

**Phase 1 — Packaging.** `bun build --compile` in CI for all 5 platform triples; ship to `resourcesPath` alongside `seed-daemon` (+ the `package.json` from F2). New `agents-process.ts` modeled on `daemon.ts`: spawn, health-poll, log-pipe, graceful shutdown, port selection. Register `http://localhost:<port>` as a built-in server URL. <!-- id:FQL9d6rj -->

**Phase 2 — Sidebar swap.** Auto-provision the `Assistant` agent (D2). Rewrite `assistant-panel.tsx` as a wrapper over the session view already used by `pages/agents/session.tsx` — extracting the shared chat surface from that 977-line page into a reusable component. Wire context (D3) and navigate (D4). Keep `chat-message-composer.tsx` and `chat-message-queue.tsx`. <!-- id:9E0fnXlY -->

**Phase 3 — Delete.** Remove the old stack (§7) once the sidebar is on the new path. Drop `@ai-sdk/*` + `ai` deps. <!-- id:G79Sq556 -->

**Phase 4 — Reach parity and beyond.** ChatGPT OAuth provider (§6), local signing (D5), then the features the sidebar gets _for free_ on day one: triggers, usage/cost display, multi-agent, `web_search`/`web_read`, stop, durable replay. <!-- id:nwsCIFBF -->

# 6. Parity gaps to close <!-- id:9S9W584T -->

1. **ChatGPT OAuth login.** ~~The one genuine feature gap.~~ **Downgraded after research — see [pi-chatgpt-oauth.md](https://github.com/seed-hypermedia/seed/blob/4af3478e9599cdd7f8f32536b2f701d2effbdf5b/docs/plans/pi-chatgpt-oauth.md) (removed from the tree, kept in history).** Pi already ships `openaiCodexOAuthProvider` (login, refresh, `chatgpt-account-id` header, `instructions`/`store:false` Responses semantics — everything `chat-provider-options.ts` hand-rolls). The agents service simply never wires pi's OAuth layer to its provider model: \~1 provider type + 3 protocol actions. Pi's login is loopback-only (`localhost:1455`), which is fine for the **local** server, so this no longer blocks phase 3. Device-auth login — which our `app-ai-config.ts` already implements and pi lacks — is needed only for the **hosted** server, and is a clean upstream contribution. <!-- id:FqxexUVe -->
2. **Secret storage strength.** Old path uses Electron `safeStorage` (OS keychain); the agent server uses AES-GCM with the key in SQLite next to the ciphertext. For a local server on the user's own disk this is a real downgrade. Fix: have the desktop supply the encryption key from `safeStorage` at spawn time. <!-- id:c4Vdgii_ -->
3. **Session migration.** Existing `chat-sessions/*.json` need importing into the local SQLite or an explicit "old chats are archived" decision. <!-- id:WOsU7pVk -->
4. **Icon upload.** `uploadIconToHmNode` POSTs to `<hmServerUrl>/ipfs/file-upload`, which the local API server on :56004 does not serve (the daemon does, on its own port). Needs a proxy route or a separate flag. <!-- id:NqU_P1k0 -->

# 7. Deletion inventory <!-- id:h5r379H- -->

Removed outright: <!-- id:c6DywnCU -->

<!-- id:MyzSJZEZ -->
| File <!-- col:GyckZyba --> | LOC <!-- col:C0iBwhRg --> <!-- id:5Amh-tcx --> |
| --- | --- |
| `src/app-chat.ts` | 1004 <!-- id:2C98awsw --> |
| `src/app-ai-config.ts` | 1138 <!-- id:QJ46JkXL --> |
| `src/models/ai-config.ts` | 215 <!-- id:ZkG2qIMv --> |
| `src/models/chat.ts` | 163 <!-- id:N6C4MIZo --> |
| `src/models/chat-parts.ts` | 110 <!-- id:XcKFg8ec --> |
| `src/chat-search.ts` | 155 <!-- id:zNCEcGWW --> |
| `src/openai-models.ts` | 64 <!-- id:oGgUG442 --> |
| `src/chat-provider-options.ts` | 39 <!-- id:wFiZ84Ef --> |
| `src/chat-stream-error.ts` | 33 <!-- id:4hHBW8fV --> |
| **subtotal** | **2921** <!-- id:Arefb0zU --> |

Tests deleted with them: `app-ai-config.test.ts` (162), `assistant-providers-settings.test.tsx` (666), `chat-search.test.ts` (119), `chat-parts.test.ts` (66), `chat-provider-options.test.ts` (48), `openai-models.test.ts` (38), `chat-stream-error.test.ts` (30) — **1129**. <!-- id:FeoauTEs -->

Shrunk substantially: `components/assistant-panel.tsx` (521 → \~120), the "Agent Assistant Providers" section of `pages/settings.tsx` (\~300 → 0, subsumed by the Agents server provider dialog), `app-api.ts` chat router wiring, plus rewrites of `assistant-panel.test.tsx` (534) and `main-assistant-visibility.test.tsx` (447). <!-- id:x9e0gelH -->

Dependencies dropped from `@shm/desktop`: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` — the entire Vercel AI SDK, used nowhere else in the app. <!-- id:I6RaG1q8 -->

**Net: \~4,800–5,300 lines deleted against roughly 600 added.** <!-- id:76YjCGw1 -->

# 8. Open questions <!-- id:D-KCS72a -->

- **Q1 — Local server lifetime.** Only while the app is open, or a background service that keeps triggers firing? Triggers are much of the value, and they need the daemon anyway. Recommend app-lifetime for phase 1. <!-- id:1bg57uoo -->
- **Q2 — Multiple windows/accounts.** One local server, many accounts (the protocol is already account-scoped) — but confirm the singleton spawn survives multi-window and account switching. <!-- id:LyYN2ssA -->
- **Q3 — Should local agents write as the user?** (D5) It is the natural expectation for a sidebar assistant and the reason `docs/desktop-assistant-write-plan.md` exists — including its approve/deny confirmation UX, which would now need to live in the shared session UI rather than the old chat path. <!-- id:WJmhbE23 -->
- **Q4 — Installer size.** +80 MB/platform on top of the existing 201 MB daemon. Acceptable? <!-- id:igNUuoAV -->
- **Q5 — `web_search`/`web_read` locally.** They need SearXNG/Crawl4AI backends. Point local agents at the hosted backends, or leave those tools off locally? <!-- id:9_dkMyN4 -->

# 9. Environments, dev loop, and packaging — verified <!-- id:tLpcgTNX -->

Everything in this section was tested, not assumed. Commands and outputs are reproducible from `agents/`. <!-- id:Tu-Mljyu -->

## 9.1 Does the compiled binary actually work? <!-- id:Hc2pWNG7 -->

Yes — but **only with `package.json` next to it**. First run crashed: `pi-coding-agent`'s `config.js` does `readFileSync(getPackageJsonPath())` at import time, resolved against `cwd`. With the file alongside and `cwd` set to that directory, verified working: <!-- id:DSan-GtU -->

``` <!-- id:BxvEN7I_ -->
$ ./seed-agents --server-port=3099 --db-path=... --data-dir=...
{"status":"ok","uptime":3.2,"version":"dev","hmServerUrl":"https://hyper.media","webTools":{...}}
```

`/agents/api/status` → 200, and `/agents` serves the embedded inspector HTML (449 B, correct doctype) — so the `import index from '@/frontend/index.html'` bundling survives `--compile`. No stray files written to `cwd` beyond the SQLite paths given by flags (use absolute paths under `userData`). The Dockerfile already does exactly this `package.json`-alongside trick, so we are matching a proven layout. <!-- id:xtSAsVzV -->

## 9.2 Cross-platform <!-- id:tccKfcmm -->

Cross-compiled from darwin/arm64; `file` confirms all four are genuine native binaries: <!-- id:JxnPQ_ey -->

<!-- id:q1Y2uKT_ -->
| Target <!-- col:9bp40bsP --> | Size <!-- col:vh4LrC-j --> | `file` output <!-- col:HW58uQoK --> <!-- id:Qh8nxSFH --> |
| --- | --- | --- |
| bun-darwin-arm64 | 80 MB | Mach-O 64-bit arm64 (host build) <!-- id:ZSV9_FRg --> |
| bun-darwin-x64 | 74 MB | Mach-O 64-bit x86_64_ <!-- id:7pzIgTvK --> |
| bun-linux-x64 | 112 MB | ELF 64-bit x86-64, glibc <!-- id:Xifa1ZUV --> |
| bun-linux-arm64 | 109 MB | ELF 64-bit ARM aarch64, glibc <!-- id:QWFTD8Ej --> |
| bun-windows-x64 | 123 MB | PE32+ console x86-64 <!-- id:UNsF2Gxd --> |

The darwin-x64 binary was additionally _executed_ under Rosetta and returned a healthy `/agents/api/health` — so these are functional, not just well-formed. **We likely do not need cross-compilation at all**: the release matrix already builds the Go daemon natively on ubuntu/macos/windows runners, so each runner can build its own agents binary. Cross-compile is the fallback. <!-- id:KNKII5Ae -->

Specific concerns, checked: <!-- id:GaFn8SS_ -->
  - **macOS hardened runtime + JIT.** Bun uses JavaScriptCore; the Go daemon does not JIT, so this was the risk I most expected to bite. `entitlements.plist` **already** grants `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, and `disable-library-validation`. Nothing to change. <!-- id:CcThuVH3 -->
  - **macOS signing — action required.** `forge.config.ts:375` lists `osxSign.binaries: [daemonBinaryPath]`. The agents binary **must** be added, or notarization ships an unsigned nested executable that won't launch on other Macs. <!-- id:icC_2eO_ -->
  - **Windows.** Needs the `.exe` suffix handled like `DAEMON_NAME` already is (release workflow passes `DAEMON_NAME: '<triple>.exe'`). Squirrel packaging itself is agnostic. <!-- id:oLb1foSJ -->
  - **Linux.** The ELF is dynamically linked against glibc — fine for deb/rpm/AppImage, would fail on musl/Alpine. Worth a note in the flatpak build (`test-flatpak-build.sh`). <!-- id:Uc23LuNw -->
  - **Missing-binary guard.** `forge.config.ts:49` throws in CI when the Windows DLL is absent. Mirror that for the agents binary so a missing build fails loudly instead of shipping a broken app. <!-- id:5zWLy6kE -->

## 9.3 Dev loop — hot reload already exists <!-- id:q7K_wqmj -->

**Yes, editing agent server code hot-reloads, and no new mechanism is needed.** `mprocs.yaml` (`./dev up`) already runs the agents server as its own pane: <!-- id:VMAk48WU -->

```yaml <!-- id:NcluVlR7 -->
agents:
  shell: 'cd agents && bun run dev'   # watch-file-deps.ts + bun --hot src/main.ts
```

`bun --hot` re-evaluates on save and `watch-file-deps.ts` re-syncs the `file:` deps (`frontend/packages/*`) so they never go stale. Sessions live in SQLite so they survive a reload, and the desktop's WebSocket client already has exponential-backoff reconnect (`models/agents.ts`). <!-- id:9n9viiR8 -->

So the rule is: **dev attaches, packaged spawns.** <!-- id:3gKcmsY4 -->
  - `./dev up` — desktop does _not_ spawn the binary; it attaches to the mprocs-run server on :3050. Hot reload intact. <!-- id:_YpBND4x -->
  - Packaged — desktop spawns the compiled binary from `resourcesPath`. <!-- id:fxSk00br -->

There is already a precedent for exactly this toggle: `SEED_NO_DAEMON_SPAWN` (`daemon.ts`) makes the desktop skip spawning the Go daemon and use externally-provided ports. Add `SEED_NO_AGENTS_SPAWN` the same way, defaulted on in the mprocs `desktop` pane. Better still, make it automatic: probe `/agents/api/health` on the configured port first and attach if something healthy answers, spawn otherwise — that removes a whole class of "two servers fighting over :3050" confusion. <!-- id:oKyFhAbT -->

## 9.4 CI — action required <!-- id:uV0qvdyf -->

**Bun is not installed in the desktop pipeline.** `.github/actions/ci-setup/action.yml` installs Go, pnpm, Node 22, Vulkan, and llama.cpp — no Bun. (`release-desktop.yml` matches `bun` only inside the word "u_bun_tu".) Needs `oven-sh/setup-bun@v2` added to `ci-setup`, plus a build step per runner mirroring the existing daemon build steps, and the artifact added to the Sentry symbol upload list alongside `seed-daemon-*`. <!-- id:KMgPo41p -->

The Docker path (`release-docker-images.yml`, `hotfix-agents-image.yml`) is untouched — it keeps using `agents/Dockerfile` and `bun run build`, not `--compile`. <!-- id:8WUd9WOu -->

## 9.5 Net answer <!-- id:cpYLf5sQ -->

<!-- id:wDWf9rfH -->
| Question <!-- col:J9Heu2D5 --> | Answer <!-- col:Qk9Dj6P5 --> <!-- id:IzG87fRs --> |
| --- | --- |
| Works in dev? | Yes — attach to the existing `bun --hot` mprocs pane, unchanged. <!-- id:6-zUQ7y0 --> |
| Hot reload on agent-code edits? | Yes, already how `./dev up` works today. <!-- id:kFexCGFB --> |
| Production binary actually working? | Verified: health, status, inspector UI — with `package.json` alongside. <!-- id:k7ZZVWr9 --> |
| Cross-platform? | All 4 targets build; x64 darwin executed OK. CI builds natively per-runner. <!-- id:i7Xp2ISa --> |
| Blocking work? | 3 items: `osxSign.binaries`, Bun in `ci-setup`, `.exe` naming. <!-- id:wzlCKoCR --> |

# 10. Risks <!-- id:UQm3n_3X -->

- **Startup ordering.** The agent server needs the local API server, which needs the daemon. A three-stage boot with health gates; the agent process must tolerate its HM backend being briefly absent. <!-- id:qlki1-wT -->
- **Port collisions.** :3050 may be taken (including by a dev instance). Needs dynamic port selection reported back to the renderer, like `local-server.ts` already does. <!-- id:q0fBdtS8 -->
- **Runtime verification on Linux and Windows.** All targets compile and darwin x64/arm64 were executed successfully, but the linux and windows binaries have not been _run_ — only format-verified. Needs a CI smoke test (`agents/scripts/smoke-build.ts` already exists for this). <!-- id:B2s3YuQl -->
- **Bundling `agents/` in CI.** It is a Bun workspace deliberately isolated from the pnpm workspaces (`agents/AGENTS.md`); the desktop build must invoke it without violating that boundary. <!-- id:wNYoCdDE -->
