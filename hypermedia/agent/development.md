---
---
\--- name: Development summary: How to work on the Seed Agents code safely: the commands, the code map with every entry point, the test map, the rules for changing the model-facing surface, and which page to update when. --- This page is for people and coding agents changing Seed Agents. It names where things are, how to run and validate them, and the conventions that keep the runtime coherent. Read the root `AGENTS.md`, then `agents/AGENTS.md` for the service (Bun only, never pnpm; `bun check && bun test` before every commit) and `frontend/AGENTS.md` for UI work. <!-- id:K7JAYkEv -->

# Commands <!-- id:72a6F9hI -->

The whole stack in one mprocs TUI (Docker web backends, desktop, web, and the agents server, one pane per process; `q` stops everything): <!-- id:45rcP_oD -->

```bash <!-- id:kTpugFCl -->
./dev up
```

The agents server alone: <!-- id:iBra6R5G -->

```bash <!-- id:4pr04rmj -->
direnv exec . bash -lc 'cd agents && bun src/main.ts'   # plain
direnv exec . bash -lc 'cd agents && bun run dev'       # hot reload, dev web backends, subscription auth on
```

Validate the service: <!-- id:w21cku7O -->

```bash <!-- id:92q4r3gT -->
direnv exec . bash -lc 'cd agents && bun check && bun test'   # typecheck + formatter, then the suite
direnv exec . bash -lc 'cd agents && bun run test:build'      # the compiled binary boots
direnv exec . bash -lc 'cd agents && bun run test:docker'     # the image boots
direnv exec . bash -lc 'cd agents && bun run test:trigger'    # real daemon, mention trigger fires once
direnv exec . bash -lc 'cd agents && bun run protocol:check'  # the protocol surface did not change silently
```

Validate the frontend: <!-- id:z1RLpVSN -->

```bash <!-- id:J9Xm3IKX -->
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm format:check'
```

Build the deployment image and run the desktop: <!-- id:LXwDSl2S -->

```bash <!-- id:L-JSfuz3 -->
docker build -t seedhypermedia/agents:dev . -f ./agents/Dockerfile
direnv exec . bash -lc './dev run-desktop'
```

`pnpm audit` fails today on repository dependency advisories unrelated to this feature; report that honestly rather than claiming it passed. <!-- id:ny9jUwE2 -->

# Local URLs <!-- id:T63k7HLv -->

The dev shell sets `SEED_AGENTS_HTTP_PORT=3051` in `.env.vars`, so the dev server never shares a port with the 3050 default a packaged build uses. <!-- id:TsG-jsNo -->

<!-- id:w8SE6S_q -->
| what <!-- col:_1WRiXMp --> | dev URL <!-- col:TDo0vFXF --> <!-- id:QLFChrGi --> |
| --- | --- |
| server base | `http://localhost:3051` <!-- id:0JDepxKs --> |
| health | `http://localhost:3051/agents/api/health` <!-- id:5IM7m_SR --> |
| signed API | `POST http://localhost:3051/api/message` <!-- id:hhM3PRG8 --> |
| WebSocket | `ws://localhost:3051/agents/ws` <!-- id:omAL0PAD --> |
| latency snapshot | `http://localhost:3051/api/perf` <!-- id:zM2v1hz1 --> |

# Code map <!-- id:l1qGFiv- -->

The service, in `agents/`: <!-- id:I1toG_st -->
  - `src/main.ts`: the Bun HTTP and WebSocket server, CORS, the webhook route, health and version, live event fan-out. <!-- id:6Mgrjc3y -->
  - `src/api-service.ts`: the heart of the service: action dispatch, persistence operations, the Pi-backed model loop, the verb implementations, the Space index, trigger firing, subscription verification. <!-- id:3mdc_Y9h -->
  - `src/auth.ts`: signed envelope verification, the five-minute timestamp window, capability-based delegation. <!-- id:o3piFt7L -->
  - `src/cbor.ts`: DAG-CBOR request and response helpers and the protocol version header. <!-- id:rfRSsgr7 -->
  - `src/config.ts`: every environment variable and CLI flag, with defaults. <!-- id:LswE9nei -->
  - `src/sqlite.ts` and `src/sqlite-schema.sql`: open, schema gate, migrations; the canonical schema. <!-- id:kpAyOzjy -->
  - `src/runs.ts`: durable run records and the dispatch queue: leases, fair-share claiming, retries, cancellation cascade, timer wakes. <!-- id:4vcGWyxX -->
  - `src/run-events.ts`: waiting runs and what wakes them. <!-- id:kGbbvqL6 -->
  - `src/workflow-host.ts`: the QuickJS script engine: lint, realm prelude, journaled effect pump, replay; `src/workflow-worker-host.ts` runs it in a worker behind a flag. <!-- id:TaUFITTv -->
  - `src/tool-documents.ts`: tools as content-addressed documents: the lambda ABI, builtin materialization, the MCP projection, authoring validation, contract markdown. <!-- id:p-4s5Rp2 -->
  - `src/mcp.ts`: remote MCP servers: connect, discover, proxy, the lazy per-run connection pool. <!-- id:xfcQtnXV -->
  - `src/web-tools.ts`: self-hosted `web_search` and the tiered web reader behind `read https://…`. <!-- id:8YgK0pIj -->
  - `src/agent-memory.ts`: the per-agent memory filesystem and the signed memory actions. <!-- id:T-vsI77Q -->
  - `src/code-exec.ts`: sandboxed execution in microsandbox microVMs, boot-per-call and the warm pool. <!-- id:asTciXkg -->
  - `src/activity-monitor.ts`, `src/activity-triggers.ts`, `src/schedule-monitor.ts`, `src/schedule-triggers.ts`: the trigger monitors and matching. <!-- id:UIBmluxQ -->
  - `src/provider-oauth.ts`: the ChatGPT subscription sign-in flow. <!-- id:TqJfEvj- -->
  - `src/json-schema.ts`: the bounded JSON Schema validator for typed results and authored contracts. <!-- id:4scILU9z -->
  - `src/perf.ts`, `src/session-perf.ts`: the latency recorder behind `/api/perf`. <!-- id:66v3Od0T -->
  - `src/protocol-compat.ts`, `src/protocol-surface.ts`: shims for older clients and the surface snapshot the CI gate diffs. <!-- id:jf1NH6Pm -->
  - `protocol/src/index.ts`: the canonical protocol types for actions, responses, session events, and WebSocket events, published as the private package `@seed-hypermedia/agents-protocol`; `protocol/PROTOCOL.md` holds the versioning rules and changelog. <!-- id:wuXFGuu3 -->
  - `protocol/src/tool-registry.ts`: the five verbs and the callable tools: model-facing descriptions, JSON schemas, render metadata. Every word of a description is prompt. <!-- id:m4xyW-wr -->
  - `protocol/src/write-guides.ts`: the per-resource guides an agent reads at `~/tools/write/<resource>`. <!-- id:ljPi4l8J -->
  - `protocol/src/delegation.ts`, `protocol/src/reasoning.ts`, `protocol/src/model-capabilities.ts`: thoroughness presets, the reasoning-level matrix, image-input support. <!-- id:sbhHJvWe -->
  - `e2e/run.ts` and `e2e/live-gate.ts`: the record/replay model gate and the live gate against a real server and model. <!-- id:EDMyrsOj -->

The shared UI, in `frontend/packages/ui/src/agents/`: `client.ts` signs and sends actions, `models.ts` holds the React Query hooks and signed subscriptions, `platform.ts` is the seam each app implements, and the pages and pieces are listed on the [desktop and web UI](./desktop-ui.md) page. The desktop's platform lives with `frontend/apps/desktop/src/pages/agents.tsx`; the web's in `frontend/apps/web/app/web-agents-platform.ts` and `web-assistant-host.tsx`. Routes are in `frontend/packages/shared/src/routes.ts`. <!-- id:_QMM36jW -->

Shared Hypermedia behaviour the service reuses from `@seed-hypermedia/client`: `resource-read.ts` (`resolveIdWithClient`, shared with the CLI), `hm-resolver.ts`, `blocks-to-markdown.ts` and `markdown-to-blocks.ts`, `explore-query.ts`, and the blob signing primitives (imported through the `@shm/shared/blobs` re-export). <!-- id:MF4Ylcua -->

# Test map <!-- id:nszQ78y6 -->

The whole service suite runs from `agents/` with `bun test`: <!-- id:QcZ8YChE -->
  - `api-service.test.ts`: the big one: actions, ownership, sessions, delegation, obligations, plans. <!-- id:v1WA7PUZ -->
  - `verbs.test.ts`: the five verbs: address dispatch, touch-expand, promotion, user-invoked verbs. <!-- id:IEq07SB6 -->
  - `tool-documents.test.ts`: CIDs, builtin materialization, lambda authoring validation. <!-- id:1H4sSkuE -->
  - `runs.test.ts`, `run-time.test.ts`: queue claiming, leases, sweeps, parks and wakes. <!-- id:caikMvwb -->
  - `workflow-host.test.ts`, `workflow-worker.test.ts`: the script engine: lint, journal replay, fuel and caps, the worker transport. <!-- id:fj1mr_e1 -->
  - `activity-triggers.test.ts`, `trigger-events.test.ts`, `activity-trigger-race.test.ts`, `schedule-triggers.test.ts`: trigger matching, firing idempotency, the comment/citation sibling race. <!-- id:fTK3pA_y -->
  - `agent-memory.test.ts`, `session-attachments.test.ts`, `code-exec.test.ts`, `exec-pool.test.ts`, `exec-verify.test.ts`, `web-tools.test.ts`, `agent-tools-api.test.ts`, `mcp.test.ts`, `session-continuation.test.ts`, `write-link-validation.test.ts`. <!-- id:tC2RMQQo -->
  - `auth.test.ts`, `sqlite.test.ts`, `main.test.ts`, `config.test.ts`, `json-schema.test.ts`, `poll-loop.test.ts`, `provider-oauth.test.ts`, `protocol-surface.test.ts`, `statements.test.ts`, `perf.test.ts`, `session-perf.test.ts`. <!-- id:-392qrQH -->
  - `e2e-replay.test.ts` shells out to `e2e/run.ts`. It currently **skips**: the cassettes predate the verb collapse (`e2e/recordings/STALE.md`), so a green run is not model-gate coverage. See [operations](./operations.md). <!-- id:cLhLv7ws -->

Frontend: the shared UI tests live in `frontend/packages/ui/src/agents/__tests__/` and the desktop's in `frontend/apps/desktop/src/__tests__/`; new page or hook tests belong beside those. <!-- id:9Bb25FAA -->

# Conventions <!-- id:MrQG6Bgv -->

- Normalize user and network input at API boundaries; internal APIs expect normalized values. <!-- id:RS0y-zWC -->
- Never hold a SQLite write transaction around a model, provider, or tool network call. <!-- id:TACnz28O -->
- Never log secrets, signed bodies, or full session or model content. <!-- id:bdGZN4X_ -->
- Protocol types live in `agents/protocol/src/index.ts`; do not recreate mirrors in the desktop or the service. A change to the surface must pass `bun run protocol:check`, and a breaking one bumps the protocol version per `protocol/PROTOCOL.md`. <!-- id:oaOlwOvA -->
- Provider responses stay redacted. <!-- id:v1_cpG9V -->
- Prefer broad tests that exercise real behaviour, and existing files over tiny one-off modules. <!-- id:GMnMav_E -->

# Adding an API action <!-- id:Yusrx60B -->

1. Add the request and response types to `agents/protocol/src/index.ts`. <!-- id:68bp4RE3 -->
2. Dispatch it in `Service.message()` with validation and account-ownership checks. <!-- id:ABZN2ZuZ -->
3. Add idempotency if client retries could duplicate side effects. <!-- id:iKsv7l1o -->
4. Emit service events if live clients need updates. <!-- id:CROBrqV1 -->
5. Add the hook in `models.ts` and any UI. <!-- id:EUHuuzzz -->
6. Add tests, run `protocol:check`, and update the [signed API](./signed-api.md). <!-- id:_S0EUw3S -->

# Adding a WebSocket event <!-- id:Hu97ZELv -->

1. Extend `AgentWSEvent` in the protocol package. <!-- id:b0Jmm1k2 -->
2. Emit the service event where the change originates and map it in the fan-out in `main.ts`. <!-- id:8xCYhLLy -->
3. Handle it in the subscription hook in `models.ts`. <!-- id:sLVISokW -->
4. Update [WebSocket subscriptions](./websocket-subscriptions.md). <!-- id:kSXSMRz- -->

# Changing the database <!-- id:X7HQ2JCB -->

1. Edit `sqlite-schema.sql`, the fresh-install baseline. <!-- id:1PYtDkPx -->
2. **Prepend** the migration to the `migrations` array in `sqlite.ts` (the array is reversed, so the newest literal applies last). Never edit or reorder a migration that has shipped. <!-- id:tlUdf6HK -->
3. Keep the two equivalent: baseline plus every migration must produce the schema in `sqlite-schema.sql`. `sqlite.test.ts` synthesizes an old baseline, applies the migrations, and asserts the resulting tables and columns; add yours to those assertions. It is not a full schema diff. <!-- id:x-zqYDyR -->
4. Never silently accept an unknown or future schema version. <!-- id:P3x_iSOP -->
5. Update [persistence](./persistence.md). <!-- id:_wvDYz61 -->

# Changing the model-facing surface <!-- id:bS7bGT8I -->

The five verbs are the whole provider-facing surface. New capability arrives as an address, an option, or a callable, never as a sixth verb. <!-- id:c9hqLvkf -->
  1. A new **address form** for `read` or `write` goes in the verb's description in the tool registry and in the address dispatch in `api-service.ts`. Edit the description as prompt. <!-- id:JkzIH8Jt -->
  2. A new **callable** goes in `callableToolRegistry` with `runtimes` including `agent-service`. It is reachable through `call`, never added to the provider payload directly; the next listing materializes it as a tool document for every agent, and the CID change is the version bump. <!-- id:3CFRldLu -->
  3. Keep touch-expand intact: a wrong or unexpanded `call` answers with the contract, not an error. <!-- id:FtdrC1Vt -->
  4. Anything promoted into the provider payload must be filtered against the agent's enabled callables, because promotion is derived from durable events and an unfiltered allowlist would let a hallucinated tool name activate a real one. <!-- id:5YLbjR8m -->
  5. Grants are `publish` plus the callable set. Do not add a grant for a verb. <!-- id:5G20WmgP -->
  6. Update [tools](./tools.md) and [security](./security.md), and if you coined a word for the mechanism, add a term page and list it in the [glossary](./glossary.md). <!-- id:SF7b6DXI -->

# Adding a provider <!-- id:OTf3ZmOJ -->

1. Add the `PROVIDER_SPECS` entry in `api-service.ts` and the matching `PROVIDER_METADATA` entry in the UI's `provider-registry.ts`. <!-- id:V6_ROH-n -->
2. If the model needs reasoning control, add its generation to `reasoning.ts` with a note on how the levels were verified; if it takes images, add it to `model-capabilities.ts`. <!-- id:_U7z8PjV -->
3. Preserve the session lifecycle and WebSocket partials; map Pi events into ordered `message`, `tool_call`, and `tool_result` events. <!-- id:VrwStUJn -->
4. Add mocked network tests for success, streaming, text-before-tool ordering, tools, missing key, and provider errors. <!-- id:kuRYQE4J -->
5. Confirm decrypted secrets stay in memory and never reach Pi auth files. <!-- id:cm0Swvpm -->
6. Update [model providers](./model-providers.md). <!-- id:MImbwolq -->

# Which page to update <!-- id:z1WePGfo -->

Documentation is part of the change, in the same commit. <!-- id:_-pHvjIO -->
  - action or response semantics: [signed API](./signed-api.md) <!-- id:JxgMnXgd -->
  - WebSocket or streaming: [WebSocket subscriptions](./websocket-subscriptions.md), [operations](./operations.md) <!-- id:hkQxRraI -->
  - schema or migrations: [persistence](./persistence.md) <!-- id:Hs727B6M -->
  - provider execution or config: [model providers](./model-providers.md) <!-- id:sXjohtq6 -->
  - verbs, callables, tool documents: [tools](./tools.md), [security](./security.md) <!-- id:RZ6Mkpxu -->
  - MCP servers: [MCP servers](./mcp.md), [tools](./tools.md), [security](./security.md) <!-- id:6Ac5BAtk -->
  - triggers: [triggers](./triggers.md) <!-- id:XCxEaSCN -->
  - UI behaviour: [desktop and web UI](./desktop-ui.md) <!-- id:y6OaZfcV -->
  - prompts: [prompt injection map](./prompt-injection-map.md) <!-- id:UNhC5zAi -->
  - auth, secrets, logging: [security](./security.md), [operations](./operations.md) <!-- id:sUBDxAjI -->
  - environment variables, deployment: [operations](./operations.md), [environments](./environments.md) <!-- id:g5CyreTk -->
  - something shipped or something new to do: the [roadmap](./roadmap.md); do not add a history page, git has the history <!-- id:lHMIyYUA -->
  - a new page: link it from [Seed Agents](../agent.md) or the page it belongs under <!-- id:cDUhtr1N -->

# Manual acceptance checklist <!-- id:IijsWeYF -->

After a core change: start the server and the app, open Agents, confirm the server is online, configure a provider, create an agent, open a session, send a message, confirm the subscription succeeds and the reply streams and persists across a reload. Then ask it to `read` a URL, `read ~/tools/`, and `read ~/memory/`; confirm tool rows appear and that a `call` of an unexpanded tool comes back as the contract. Run a verb from the wrench palette and confirm the You chip and that the agent sees it. Give it a task worth a checklist and a delegation; confirm the run card shows the plan, the child attaches to the running step, and the parent resumes with the result. <!-- id:QokFTRwA -->
