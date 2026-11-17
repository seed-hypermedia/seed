---
name: Development
summary: How to run, validate and change the app environment and its shared UI, with the conventions and step lists that keep the model-facing surface coherent.
---
This page is for people and coding agents changing [Seed Agents](../agent.md): the [app environment](../software/app-environment.md) server in `apps/` and the agents UI the Seed apps share. It says how to run and validate them, the conventions that keep the runtime coherent, and the steps for each common kind of change. Read the root `AGENTS.md`, then `apps/AGENTS.md` for the service (Bun only, never pnpm; `bun check && bun test` before every commit) and `frontend/AGENTS.md` for UI work. General repository setup is in [Contributing](./contributing.md), the file-by-file map is in [Code map](./code-map.md), and the suites and gates are in [Testing the app environment](./testing-the-app-environment.md). <!-- id:K7JAYkEv -->

# Commands <!-- id:72a6F9hI -->

The whole stack in one mprocs TUI (Docker web backends, desktop, web, and the app environment, one pane per process; `q` stops everything): <!-- id:45rcP_oD -->

```bash <!-- id:kTpugFCl -->
./dev up
```

The app environment alone: <!-- id:iBra6R5G -->

```bash <!-- id:4pr04rmj -->
direnv exec . bash -lc 'cd apps && bun src/main.ts'   # plain
direnv exec . bash -lc 'cd apps && bun run dev'       # hot reload, dev web backends, subscription auth on
```

Validate the service: <!-- id:w21cku7O -->

```bash <!-- id:92q4r3gT -->
direnv exec . bash -lc 'cd apps && bun check && bun test'   # typecheck + formatter, then the suite
direnv exec . bash -lc 'cd apps && bun run test:build'      # the compiled binary boots
direnv exec . bash -lc 'cd apps && bun run test:docker'     # the image boots
direnv exec . bash -lc 'cd apps && bun run test:trigger'    # real daemon, mention trigger fires once
direnv exec . bash -lc 'cd apps && bun run test:outbox'     # real daemon, effect outbox across kill -9, disk floor, ENOSPC
direnv exec . bash -lc 'cd apps && bun run protocol:check'  # the protocol surface did not change silently
```

Validate the frontend: <!-- id:z1RLpVSN -->

```bash <!-- id:J9Xm3IKX -->
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm format:check'
```

Build the deployment image and run the desktop: <!-- id:LXwDSl2S -->

```bash <!-- id:L-JSfuz3 -->
docker build -t seedhypermedia/apps:dev . -f ./apps/Dockerfile
direnv exec . bash -lc './dev run-desktop'
```

The image is published as `seedhypermedia/apps`, and each tag is also pushed under the name `seedhypermedia/agents`.

# Local URLs <!-- id:T63k7HLv -->

The dev shell sets `SEED_APPS_HTTP_PORT=3051` in `.env.vars`, so the dev server never shares a port with the 3050 default a packaged build uses. <!-- id:TsG-jsNo -->

The API is mounted under the prefix `/hm/api/apps`. The same routes answer under `/hm/api/agents`, the prefix that released clients and handed-out webhook URLs name. [Signed API](../build/signed-api.md) lists every path, including the older unprefixed ones.

<!-- id:w8SE6S_q -->
| what <!-- col:_1WRiXMp --> | dev URL <!-- col:TDo0vFXF --> <!-- id:QLFChrGi --> |
| --- | --- |
| server base | `http://localhost:3051` <!-- id:0JDepxKs --> |
| health | `http://localhost:3051/hm/api/apps/health` <!-- id:5IM7m_SR --> |
| version | `http://localhost:3051/hm/api/apps/version` |
| signed API | `POST http://localhost:3051/hm/api/apps/message` <!-- id:hhM3PRG8 --> |
| WebSocket | `ws://localhost:3051/hm/api/apps/ws` <!-- id:omAL0PAD --> |
| latency snapshot | `http://localhost:3051/hm/api/apps/perf` and `/hm/api/apps/perf/sessions/<sessionId>` <!-- id:kcALtaWq --> |
| metrics | `http://localhost:3051/hm/api/apps/metrics` |

# Conventions <!-- id:MrQG6Bgv -->

- Normalize user and network input at API boundaries. Internal APIs expect normalized values. <!-- id:RS0y-zWC -->
- Never hold a SQLite write transaction around a model, provider, or tool network call. <!-- id:TACnz28O -->
- Never log secrets, signed bodies, or full session or model content. <!-- id:bdGZN4X_ -->
- Protocol types live in `apps/protocol/src/index.ts`. Do not recreate mirrors in the desktop or the service. A change to the surface must pass `bun run protocol:check`, and a breaking one bumps the protocol version per `apps/protocol/PROTOCOL.md`. <!-- id:oaOlwOvA -->
- Provider responses stay redacted. <!-- id:v1_cpG9V -->
- Prefer broad tests that exercise real behaviour, and existing files over tiny one-off modules. <!-- id:GMnMav_E -->

# Adding an API action <!-- id:Yusrx60B -->

1. Add the request and response types to `apps/protocol/src/index.ts`. <!-- id:68bp4RE3 -->
2. Dispatch it in `Service.message()` with validation and account-ownership checks. <!-- id:ABZN2ZuZ -->
3. Add idempotency if client retries could duplicate side effects. <!-- id:iKsv7l1o -->
4. Emit service events if live clients need updates. <!-- id:CROBrqV1 -->
5. Add the hook in `models.ts` and any UI. <!-- id:EUHuuzzz -->
6. Add tests, run `protocol:check`, and update the [signed API](../build/signed-api.md). <!-- id:_S0EUw3S -->

# Adding a WebSocket event <!-- id:Hu97ZELv -->

1. Extend `AgentWSEvent` in the protocol package. <!-- id:b0Jmm1k2 -->
2. Emit the service event where the change originates and map it in the fan-out in `main.ts`. <!-- id:8xCYhLLy -->
3. Handle it in the subscription hook in `models.ts`. <!-- id:sLVISokW -->
4. Update [WebSocket subscriptions](../build/websocket-subscriptions.md). <!-- id:kSXSMRz- -->

# Changing the database <!-- id:X7HQ2JCB -->

1. Edit `sqlite-schema.sql`, the fresh-install baseline. <!-- id:1PYtDkPx -->
2. **Prepend** the migration to the `migrations` array in `sqlite.ts` (the array is reversed, so the newest literal applies last). Never edit or reorder a migration that has shipped. <!-- id:tlUdf6HK -->
3. Keep the two equivalent: baseline plus every migration must produce the schema in `sqlite-schema.sql`. `sqlite.test.ts` synthesizes an old baseline, applies the migrations, and asserts the resulting tables and columns; add yours to those assertions. It is not a full schema diff. <!-- id:x-zqYDyR -->
4. Never silently accept an unknown or future schema version. <!-- id:P3x_iSOP -->
5. Update [persistence](../operate/persistence.md). <!-- id:_wvDYz61 -->

# Changing the model-facing surface <!-- id:bS7bGT8I -->

The verbs (the five working verbs plus `status` and `continue_session`) are the whole provider-facing surface. New capability arrives as an address, an option, or a callable, never as another verb without a design discussion. <!-- id:c9hqLvkf -->
  1. A new **address form** for `read` or `write` goes in the verb's description in the tool registry and in the address dispatch in `api-service.ts`. Edit the description as prompt. <!-- id:JkzIH8Jt -->
  2. A new **callable** goes in `callableToolRegistry` with `runtimes` including `agent-service`. It is reachable through `call` and never added to the provider payload directly. The next listing materializes it as a tool document for every agent, and the CID change is the version bump. <!-- id:3CFRldLu -->
  3. Keep touch-expand intact: a wrong or unexpanded `call` answers with the contract, and never with an error. <!-- id:FtdrC1Vt -->
  4. Anything [promoted](../agent/promotion.md) into the provider payload must be filtered against the agent's enabled callables, because promotion is derived from durable events and an unfiltered allowlist would let a hallucinated tool name activate a real one. <!-- id:5YLbjR8m -->
  5. [Grants](../agent/grants.md) are `publish` plus the callable set. Do not add a grant for a verb. <!-- id:5G20WmgP -->
  6. Update [tools](../agent/tools.md) and [security](../agent/security.md), and if you coined a word for the mechanism, add a term page and list it in the [glossary](../agent/glossary.md). <!-- id:SF7b6DXI -->

# Adding a provider <!-- id:OTf3ZmOJ -->

1. Add the `PROVIDER_SPECS` entry in `api-service.ts` and the matching `PROVIDER_METADATA` entry in the UI's `provider-registry.ts`. <!-- id:V6_ROH-n -->
2. If the model needs reasoning control, add its generation to `reasoning.ts` with a note on how the levels were verified. If it takes images, add it to `model-capabilities.ts`. <!-- id:_U7z8PjV -->
3. Preserve the session lifecycle and WebSocket partials. Check that the durable store's entries project into ordered `message`, `tool_call`, and `tool_result` events. <!-- id:VrwStUJn -->
4. Add mocked network tests for success, streaming, text-before-tool ordering, tools, missing key, and provider errors. <!-- id:kuRYQE4J -->
5. Confirm decrypted secrets stay in memory and never reach the durable store or a Pi auth file. <!-- id:cm0Swvpm -->
6. Update [model providers](../agent/model-providers.md). <!-- id:MImbwolq -->

# Changing a prompt

[What an agent is told](../agent/prompt.md) lists every source of model-facing text. When you change one:

1. Update shared instructions first when behavior should apply everywhere. <!-- id:VOK56HfI -->
2. Keep `#agentSystemPrompt()` assembly small and ordered. Every block you add costs context on every turn. <!-- id:UDqqI0c9 -->
3. Use an ephemeral per-turn block for a reminder of current state. Use a durable event for a record of something that happened. <!-- id:sSf6minb -->
4. If a new block frames text written by anyone but the server, escape it and add it to the list of untrusted sources on that page. <!-- id:kiJ8l6rA -->
5. Update tool descriptions in `apps/protocol/src/tool-registry.ts` when behavior depends on tool use. <!-- id:PjDSTL-L -->
6. Inspect a live session through `GetSession.systemPromptMarkdown` or the session's system prompt dialog. <!-- id:Owoth1sD -->

# Security checks for new work

[Security](../agent/security.md) explains the model these steps protect.

For every new action: <!-- id:axAWn385 -->
  1. Verify signature. <!-- id:7faLpQy_ -->
  2. Verify signer authorization. <!-- id:dRwdiRcR -->
  3. Normalize inputs at the boundary. <!-- id:27CsEQc_ -->
  4. Scope DB queries by account ownership. <!-- id:NhmrAlp7 -->
  5. Redact sensitive data. <!-- id:UwLTwcN8 -->
  6. Add unauthorized and cross-account tests, including reader-vs-writer and pending-vs-accepted behavior for agent-scoped actions. <!-- id:jG6YnMUV -->
  7. Decide idempotency and replay semantics. <!-- id:VqnyHsSW -->
  8. Decide WebSocket fanout policy. <!-- id:6RJAfdo7 -->

For every new tool or address form: <!-- id:CwIdOyUb -->
  1. Add or update the canonical registry entry in `apps/protocol/src/tool-registry.ts` so prompt metadata, input schema, and rendering metadata are reviewed together. <!-- id:QKpeyRPQ -->
  2. Decide the grant: callable set, publish, or ungated. <!-- id:YbrvNPlW -->
  3. Validate inputs at the runtime boundary and return the contract on a miss. <!-- id:6-8VGr0S -->
  4. Bound output size. <!-- id:A6KLJ63H -->
  5. If it can be promoted, confirm the promotion filter still holds. <!-- id:hjF1aWK3 -->
  6. If model-authored text re-enters the prompt inside a frame, escape it. <!-- id:0KW3vaxq -->
  7. Avoid sensitive logs. <!-- id:hCefS6od -->
  8. Add tests for missing credentials and provider or tool errors. <!-- id:DT_jTHUr -->

# Which page to update <!-- id:z1WePGfo -->

Documentation is part of the change, in the same commit. <!-- id:_-pHvjIO -->
  - action or response semantics: [signed API](../build/signed-api.md) <!-- id:JxgMnXgd -->
  - WebSocket or streaming: [WebSocket subscriptions](../build/websocket-subscriptions.md), [operations](../operate/operations.md) <!-- id:hkQxRraI -->
  - schema or migrations: [persistence](../operate/persistence.md) <!-- id:Hs727B6M -->
  - provider execution or config: [model providers](../agent/model-providers.md) <!-- id:sXjohtq6 -->
  - verbs, callables, tool documents: [tools](../agent/tools.md), [security](../agent/security.md) <!-- id:RZ6Mkpxu -->
  - MCP servers: [MCP servers](../agent/mcp.md), [tools](../agent/tools.md), [security](../agent/security.md) <!-- id:6Ac5BAtk -->
  - triggers: [triggers](../agent/triggers.md) <!-- id:XCxEaSCN -->
  - UI behaviour: [in the app](../agent/in-the-app.md) <!-- id:y6OaZfcV -->
  - prompts: [what an agent is told](../agent/prompt.md) <!-- id:UNhC5zAi -->
  - auth, secrets, logging: [security](../agent/security.md), [operations](../operate/operations.md) <!-- id:sUBDxAjI -->
  - environment variables, deployment: [operations](../operate/operations.md), [environments](../operate/environments.md) <!-- id:g5CyreTk -->
  - files moved or added: [Code map](./code-map.md)
  - a new page: link it from [Seed Agents](../agent.md) or the page it belongs under. This site holds no history page. Git has the history. <!-- id:cDUhtr1N -->

# Manual smoke test <!-- id:IijsWeYF -->

After a core change, run through this by hand:

1. Start a server and the app. Configure a provider and create an agent. <!-- id:2-mCTqPr -->
2. Open a session and send a message. Confirm it appears immediately, the subscription succeeds, and the reply streams as markdown. <!-- id:lasrcBtg -->
3. Ask the agent to read a Seed URL, including a custom-domain web URL. Confirm the row shows the resolved target. Then ask it to `read ~/tools/` and `read ~/memory/`. <!-- id:yDijYCVS -->
4. Confirm that a `call` of an unexpanded tool comes back as the contract. <!-- id:QokFTRwA -->
5. Ask for a task with three or more steps and two delegations. Confirm the pinned card shows the checklist with both children as peers, each child attaches to the running step, the parent resumes with the results, and the card freezes into the transcript when the run ends. <!-- id:6gqbLXr0 -->
6. Ask the agent to write itself a tool and call it. Confirm the row appears under Custom tools. <!-- id:K_lfckOv -->
7. Run a read from the wrench. Confirm the You chip and that the agent refers to it next turn. <!-- id:gg9uksVt -->
8. Reload. Confirm the transcript, run cards, and card state reconstruct. <!-- id:fe2AgLbi -->

# See also <!-- id:zPiwykmo -->

- [Operations](../operate/operations.md) <!-- id:n4QkH6sG -->
- [Environments](../operate/environments.md) <!-- id:xAKxp5eo -->
- [How it works](../agent/how-it-works.md) <!-- id:koi4XoLt -->
- [Code map](./code-map.md)
- [Testing the app environment](./testing-the-app-environment.md)
- [Tools](../agent/tools.md) <!-- id:UZ1y3WVD -->
- [Persistence](../operate/persistence.md) <!-- id:Q6M0O-yD -->
- [App environment](../software/app-environment.md) <!-- id:cq7YdHE3 -->
- [Contributing](./contributing.md) <!-- id:PX0gDkk6 -->
