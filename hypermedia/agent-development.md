---
name: Development
summary: This document tells future agents how to work on the Agents feature safely and how to keep this knowledgebase current without waiting for manual instructions.
---
This document tells future agents how to work on the Agents feature safely and how to keep this knowledgebase current without waiting for manual instructions. <!-- id:K7JAYkEv -->

# Required instructions <!-- id:72a6F9hI -->

Read before editing: <!-- id:45rcP_oD -->
  - root `AGENTS.md`; <!-- id:eqZf8hys -->
  - `agents/AGENTS.md` for `agents/**`; <!-- id:miSwQdtC -->
  - `frontend/AGENTS.md` for desktop/frontend changes. <!-- id:onifzqtd -->

# Commands <!-- id:T63k7HLv -->

Full dev stack (docker web backends + desktop + web + agents server) in one mprocs TUI, one pane per process: <!-- id:TsG-jsNo -->

```bash <!-- id:fGePDBa6 -->
./dev up
```

The backends (SearXNG :8899, crawl4ai :11235) run inline as the `backends` pane via `agents/dev/web-backends/docker-compose.yml` and stop when you quit mprocs (`q`). Config: `mprocs.yaml` at the repo root. <!-- id:G78p9tqd -->

Agents: <!-- id:rEJidivZ -->

```bash <!-- id:z8LkjSrt -->
direnv exec . bash -lc 'cd agents && bun check'
direnv exec . bash -lc 'cd agents && bun test'
direnv exec . bash -lc 'cd agents && bun check && bun test'
```

Frontend: <!-- id:jyIYHjqe -->

```bash <!-- id:lxj4ShFp -->
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm format:write'
```

Targeted desktop tests often useful for streaming markdown changes: <!-- id:ZKtcloJN -->

```bash <!-- id:ibknzVW9 -->
direnv exec . bash -lc 'pnpm --filter @shm/desktop test:unit src/__tests__/assistant-panel.test.tsx src/__tests__/markdown.test.tsx'
```

Desktop smoke launch: <!-- id:tMJ-iG75 -->

```bash <!-- id:qZ4eroRS -->
direnv exec . bash -lc './dev run-desktop'
```

# Test map <!-- id:l1qGFiv- -->

Agents — the whole suite runs from `agents/` with `bun test`: <!-- id:I1toG_st -->
  - `agents/src/api-service.test.ts` — the big one: actions, ownership, sessions, delegation, obligations, plans. <!-- id:6Mgrjc3y -->
  - `agents/src/verbs.test.ts` — the five verbs: address dispatch, touch-expand, promotion, user-invoked verbs. <!-- id:3mdc_Y9h -->
  - `agents/src/tool-documents.test.ts` — tool documents: CIDs, builtin materialization, lambda authoring validation. <!-- id:o3piFt7L -->
  - `agents/src/runs.test.ts`, `agents/src/run-time.test.ts` — queue claiming, leases, sweeps, parks and wakes. <!-- id:rfRSsgr7 -->
  - `agents/src/workflow-host.test.ts` — script engine: lint, journal replay, fuel and caps. <!-- id:LswE9nei -->
  - `agents/src/activity-triggers.test.ts`, `agents/src/trigger-events.test.ts`, `agents/src/activity-trigger-race.test.ts`, `agents/src/schedule-triggers.test.ts` — trigger matching, firing idempotency, and the comment/citation sibling race. <!-- id:kpAyOzjy -->
  - `agents/src/agent-memory.test.ts`, `agents/src/session-attachments.test.ts`, `agents/src/code-exec.test.ts`, `agents/src/web-tools.test.ts`, `agents/src/agent-tools-api.test.ts`. <!-- id:4vcGWyxX -->
  - `agents/src/auth.test.ts`, `agents/src/sqlite.test.ts`, `agents/src/main.test.ts`, `agents/src/config.test.ts`, `agents/src/json-schema.test.ts`, `agents/src/poll-loop.test.ts`, `agents/src/provider-oauth.test.ts`. <!-- id:kGbbvqL6 -->
  - `agents/src/e2e-replay.test.ts` — shells out to `e2e/run.ts`. **It currently skips**: the cassettes predate the verb collapse (`e2e/recordings/STALE.md`), so a green run here is not model-gate coverage. See `operations.md`. <!-- id:TaUFITTv -->

Desktop relevant areas: <!-- id:_QMM36jW -->
  - `frontend/apps/desktop/src/__tests__/assistant-panel.test.tsx` <!-- id:pr04SwXm -->
  - `frontend/apps/desktop/src/__tests__/markdown.test.tsx` <!-- id:aQncn1pL -->
  - any future Agents page/hook tests should live near existing desktop tests. <!-- id:VfKAbx_z -->

# Development conventions <!-- id:nszQ78y6 -->

- Normalize user/network input at API boundaries. <!-- id:QcZ8YChE -->
- Keep internal APIs expecting normalized values. <!-- id:9Bb25FAA -->
- Do not hold SQLite write transactions around model/provider/tool network calls. <!-- id:6NhFPljY -->
- Do not log secrets, signed bodies, or full session/model content. <!-- id:nzF4ofuc -->
- Update shared protocol types in `agents/protocol/src/index.ts`; do not recreate desktop/server protocol mirrors. <!-- id:IhqdJNoo -->
- Keep provider responses redacted. <!-- id:hrx6ZOQK -->
- Use broad tests that exercise real behavior. <!-- id:pTwBaeul -->
- Prefer existing files over tiny one-off modules unless extraction improves ownership. <!-- id:midZUak8 -->

# Adding API actions <!-- id:MrQG6Bgv -->

1. Update `agents/protocol/src/index.ts` request/response types. <!-- id:RS0y-zWC -->
2. Update service dispatch in `Service.message()`. <!-- id:TACnz28O -->
3. Implement action with validation and account ownership checks. <!-- id:bdGZN4X_ -->
4. Add idempotency if client retries could duplicate side effects. <!-- id:oaOlwOvA -->
5. Emit `ServiceEvent`s if live clients need updates. <!-- id:v1_cpG9V -->
6. Use the shared protocol aliases from `agents-client.ts`; do not add manual mirror types. <!-- id:GMnMav_E -->
7. Add desktop hook/UI if needed. <!-- id:Rtz_4d-X -->
8. Add tests. <!-- id:Wd_d7z2O -->
9. Update docs. <!-- id:-YJwAyO4 -->

# Adding WebSocket events <!-- id:Yusrx60B -->

1. Update `AgentWSEvent` in `agents/protocol/src/index.ts`. <!-- id:68bp4RE3 -->
2. Add/emit service event if business logic originates it. <!-- id:ABZN2ZuZ -->
3. Map it in `main.ts` publish fanout. <!-- id:iKsv7l1o -->
4. Handle it in `useAgentWebSocketSubscription()`. <!-- id:CROBrqV1 -->
5. Add safe diagnostics if useful. <!-- id:EUHuuzzz -->
6. Update `websocket-subscriptions.md`. <!-- id:_S0EUw3S -->

# Adding database changes <!-- id:Hu97ZELv -->

1. Edit `sqlite-schema.sql` — the fresh-install baseline. <!-- id:b0Jmm1k2 -->
2. **Prepend** the migration to the `migrations` array in `sqlite.ts` (the array is reversed, so the newest literal is applied last). Never edit or reorder a migration that has shipped. <!-- id:8xCYhLLy -->
3. Keep the two equivalent: baseline + every migration must produce the same schema as `sqlite-schema.sql`. `sqlite.test.ts` synthesizes an old baseline by stripping sections out of the current schema, applies the migrations, and asserts the resulting tables and columns exist — add your new table or column to those assertions. It is not a full schema diff, so equivalence is still yours to verify. <!-- id:sLVISokW -->
4. Add migration and fresh-init tests. <!-- id:kSXSMRz- -->
5. Update `persistence.md`. <!-- id:kT7-Nuce -->
6. Do not silently accept unknown/future versions. <!-- id:fzwLc6T8 -->

# Changing the model-facing tool surface <!-- id:X7HQ2JCB -->

The five verbs are the whole provider-facing surface and new capability must arrive as an address, an option, or a callable — not as a sixth verb. In practice: <!-- id:1PYtDkPx -->
  1. A new **address form** (`read`/`write`) goes in the verb's `description` in `agents/protocol/src/tool-registry.ts` and in the address dispatch in `api-service.ts`. Every word of that description is prompt: edit it as prompt. <!-- id:WYEom0kI -->
  2. A new **callable tool** goes in `callableToolRegistry` with `runtimes` including `agent-service`. It is reachable through `call` and is never added to the provider payload directly; `ensureBuiltinToolDocuments` materializes it as a tool document for every agent on the next listing, and the CID change is the version bump. <!-- id:nsXiUwfI -->
  3. Keep touch-expand intact: a wrong or unexpanded `call` must answer with the tool's contract, not an error. <!-- id:KJqpoAuA -->
  4. Anything promoted into the provider payload must be filtered against the agent's enabled callable set. Promotion is derived from durable events, so an unfiltered allowlist would let a hallucinated tool name activate a real one. <!-- id:Hv7ExkDk -->
  5. Grants are `publish` plus the callable set. Do not add a grant for a verb. <!-- id:Ykb7A5Ga -->
  6. Update `tools.md`, `security.md`, and — if you invented a word for the mechanism — `glossary.md`. <!-- id:yVL1ZPWB -->

# Adding provider backends <!-- id:bS7bGT8I -->

1. Add provider-specific runner. <!-- id:c9hqLvkf -->
2. Keep session lifecycle consistent. <!-- id:FvKGpu0A -->
3. Stream partials through the same WebSocket path. <!-- id:jtURdj6Z -->
4. Map tools to durable internal events. <!-- id:F8lMUUFt -->
5. Add mocked network tests. <!-- id:1G9qzdMo -->
6. Update `model-providers.md`, `security.md`, `roadmap.md`. <!-- id:wnhwF5_x -->

# Documentation automation contract <!-- id:OTf3ZmOJ -->

Future agents must treat docs as part of the implementation. When code changes, update docs in the same PR/commit. <!-- id:V6_ROH-n -->

Update routing: <!-- id:_U7z8PjV -->
  - `agents/protocol/src/index.ts`, `api.ts`, or action semantics → `signed-api.md` <!-- id:AJhrbqk5 -->
  - WebSocket/live streaming → `websocket-subscriptions.md`, `operations.md` <!-- id:9IQ4iwZO -->
  - DB/schema → `persistence.md` <!-- id:g3aU94at -->
  - provider execution/config → `model-providers.md` <!-- id:jUxNp_G3 -->
  - verbs, callables, tool documents (`agents/protocol/src/tool-registry.ts`, `tool-documents.ts`) → `tools.md`, `security.md` <!-- id:ySdKFQlW -->
  - new vocabulary for a mechanism → `glossary.md`, then use its words everywhere else <!-- id:OUcHRa0u -->
  - desktop workflow/rendering → `desktop-ui.md` <!-- id:i55-3Tm8 -->
  - security/auth/secrets/logging → `security.md` <!-- id:wRkLlvnb -->
  - major milestone completed → `implementation-history.md`, `roadmap.md` <!-- id:sNfgHKyl -->
  - future work discovered → `future-projects.md`, `roadmap.md` <!-- id:XBfsMYO1 -->
  - new doc file → link from `readme.md` <!-- id:bisQS0xh -->

Before finishing, run: <!-- id:VrwStUJn -->

```bash <!-- id:4iEHZIah -->
rg -n "TODO|not implemented|future|roadmap|Anthropic|Google|StopSession|nonce|KMS" agents/docs
```

Then confirm references are intentional and current. <!-- id:cm0Swvpm -->

# Manual acceptance checklist <!-- id:z1WePGfo -->

After core changes: <!-- id:_-pHvjIO -->
  1. Start agents server. <!-- id:JxgMnXgd -->
  2. Start desktop. <!-- id:hkQxRraI -->
  3. Open Agents. <!-- id:Hs727B6M -->
  4. Confirm health online. <!-- id:sXjohtq6 -->
  5. Configure OpenAI provider. <!-- id:RZ6Mkpxu -->
  6. Create agent. <!-- id:6Ac5BAtk -->
  7. Create/open session. <!-- id:XCxEaSCN -->
  8. Send message. <!-- id:y6OaZfcV -->
  9. Confirm WebSocket subscription succeeds. <!-- id:UNhC5zAi -->
  10. Confirm assistant streams as markdown. <!-- id:sUBDxAjI -->
  11. Confirm final message persists after refresh. <!-- id:g5CyreTk -->
  12. Ask it to `read` a URL, then to `read ~/tools/` and `read ~/memory/`. <!-- id:lHMIyYUA -->
  13. Confirm tool call/result events appear, and that a `call` for an unexpanded tool comes back as that tool's contract rather than an error. <!-- id:cDUhtr1N -->
  14. Run a verb yourself from the composer's wrench palette; confirm the result lands on the log with a "You" chip and that the agent's next turn sees it. <!-- id:xtoknpdv -->
  15. Give it a task worth a checklist and a delegation; confirm the run card shows the plan, the child attaches to the running step, and the parent resumes with the child's result. <!-- id:qkRxSYh2 -->
  16. Reload the session page and confirm the durable session events are still visible. <!-- id:3y4aGrgS -->

# Known validation caveat <!-- id:IijsWeYF -->

`pnpm audit` fails today because of existing repo dependency advisories unrelated to this feature. Report it honestly; do not mark it as passed unless fixed. <!-- id:QokFTRwA -->
