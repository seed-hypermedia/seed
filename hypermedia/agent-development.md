---
name: "Development"
summary: "This document tells future agents how to work on the Agents feature safely and how to keep this knowledgebase current without waiting for manual instructions."
---
This document tells future agents how to work on the Agents feature safely and how to keep this knowledgebase current
without waiting for manual instructions.

## Required instructions

Read before editing:

- root `AGENTS.md`;
- `agents/AGENTS.md` for `agents/**`;
- `frontend/AGENTS.md` for desktop/frontend changes.

## Commands

Full dev stack (docker web backends + desktop + web + agents server) in one mprocs TUI, one pane per process:

```bash
./dev up
```

The backends (SearXNG :8899, crawl4ai :11235) run inline as the `backends` pane via
`agents/dev/web-backends/docker-compose.yml` and stop when you quit mprocs (`q`). Config: `mprocs.yaml` at the repo
root.

Agents:

```bash
direnv exec . bash -lc 'cd agents && bun check'
direnv exec . bash -lc 'cd agents && bun test'
direnv exec . bash -lc 'cd agents && bun check && bun test'
```

Frontend:

```bash
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm format:write'
```

Targeted desktop tests often useful for streaming markdown changes:

```bash
direnv exec . bash -lc 'pnpm --filter @shm/desktop test:unit src/__tests__/assistant-panel.test.tsx src/__tests__/markdown.test.tsx'
```

Desktop smoke launch:

```bash
direnv exec . bash -lc './dev run-desktop'
```

## Test map

Agents — the whole suite runs from `agents/` with `bun test`:

- `agents/src/api-service.test.ts` — the big one: actions, ownership, sessions, delegation, obligations, plans.
- `agents/src/verbs.test.ts` — the five verbs: address dispatch, touch-expand, promotion, user-invoked verbs.
- `agents/src/tool-documents.test.ts` — tool documents: CIDs, builtin materialization, lambda authoring validation.
- `agents/src/runs.test.ts`, `agents/src/run-time.test.ts` — queue claiming, leases, sweeps, parks and wakes.
- `agents/src/workflow-host.test.ts` — script engine: lint, journal replay, fuel and caps.
- `agents/src/activity-triggers.test.ts`, `agents/src/trigger-events.test.ts`,
  `agents/src/activity-trigger-race.test.ts`, `agents/src/schedule-triggers.test.ts` — trigger matching, firing
  idempotency, and the comment/citation sibling race.
- `agents/src/agent-memory.test.ts`, `agents/src/session-attachments.test.ts`, `agents/src/code-exec.test.ts`,
  `agents/src/web-tools.test.ts`, `agents/src/agent-tools-api.test.ts`.
- `agents/src/auth.test.ts`, `agents/src/sqlite.test.ts`, `agents/src/main.test.ts`, `agents/src/config.test.ts`,
  `agents/src/json-schema.test.ts`, `agents/src/poll-loop.test.ts`, `agents/src/provider-oauth.test.ts`.
- `agents/src/e2e-replay.test.ts` — shells out to `e2e/run.ts`. **It currently skips**: the cassettes predate the verb
  collapse (`e2e/recordings/STALE.md`), so a green run here is not model-gate coverage. See `operations.md`.

Desktop relevant areas:

- `frontend/apps/desktop/src/__tests__/assistant-panel.test.tsx`
- `frontend/apps/desktop/src/__tests__/markdown.test.tsx`
- any future Agents page/hook tests should live near existing desktop tests.

## Development conventions

- Normalize user/network input at API boundaries.
- Keep internal APIs expecting normalized values.
- Do not hold SQLite write transactions around model/provider/tool network calls.
- Do not log secrets, signed bodies, or full session/model content.
- Update shared protocol types in `agents/protocol/src/index.ts`; do not recreate desktop/server protocol mirrors.
- Keep provider responses redacted.
- Use broad tests that exercise real behavior.
- Prefer existing files over tiny one-off modules unless extraction improves ownership.

## Adding API actions

1. Update `agents/protocol/src/index.ts` request/response types.
2. Update service dispatch in `Service.message()`.
3. Implement action with validation and account ownership checks.
4. Add idempotency if client retries could duplicate side effects.
5. Emit `ServiceEvent`s if live clients need updates.
6. Use the shared protocol aliases from `agents-client.ts`; do not add manual mirror types.
7. Add desktop hook/UI if needed.
8. Add tests.
9. Update docs.

## Adding WebSocket events

1. Update `AgentWSEvent` in `agents/protocol/src/index.ts`.
2. Add/emit service event if business logic originates it.
3. Map it in `main.ts` publish fanout.
4. Handle it in `useAgentWebSocketSubscription()`.
5. Add safe diagnostics if useful.
6. Update `websocket-subscriptions.md`.

## Adding database changes

1. Edit `sqlite-schema.sql` — the fresh-install baseline.
2. **Prepend** the migration to the `migrations` array in `sqlite.ts` (the array is reversed, so the newest literal is
   applied last). Never edit or reorder a migration that has shipped.
3. Keep the two equivalent: baseline + every migration must produce the same schema as `sqlite-schema.sql`.
   `sqlite.test.ts` synthesizes an old baseline by stripping sections out of the current schema, applies the migrations,
   and asserts the resulting tables and columns exist — add your new table or column to those assertions. It is not a
   full schema diff, so equivalence is still yours to verify.
4. Add migration and fresh-init tests.
5. Update `persistence.md`.
6. Do not silently accept unknown/future versions.

## Changing the model-facing tool surface

The five verbs are the whole provider-facing surface and new capability must arrive as an address, an option, or a
callable — not as a sixth verb. In practice:

1. A new **address form** (`read`/`write`) goes in the verb's `description` in `agents/protocol/src/tool-registry.ts`
   and in the address dispatch in `api-service.ts`. Every word of that description is prompt: edit it as prompt.
2. A new **callable tool** goes in `callableToolRegistry` with `runtimes` including `agent-service`. It is reachable
   through `call` and is never added to the provider payload directly; `ensureBuiltinToolDocuments` materializes it as a
   tool document for every agent on the next listing, and the CID change is the version bump.
3. Keep touch-expand intact: a wrong or unexpanded `call` must answer with the tool's contract, not an error.
4. Anything promoted into the provider payload must be filtered against the agent's enabled callable set. Promotion is
   derived from durable events, so an unfiltered allowlist would let a hallucinated tool name activate a real one.
5. Grants are `publish` plus the callable set. Do not add a grant for a verb.
6. Update `tools.md`, `security.md`, and — if you invented a word for the mechanism — `glossary.md`.

## Adding provider backends

1. Add provider-specific runner.
2. Keep session lifecycle consistent.
3. Stream partials through the same WebSocket path.
4. Map tools to durable internal events.
5. Add mocked network tests.
6. Update `model-providers.md`, `security.md`, `roadmap.md`.

## Documentation automation contract

Future agents must treat docs as part of the implementation. When code changes, update docs in the same PR/commit.

Update routing:

- `agents/protocol/src/index.ts`, `api.ts`, or action semantics → `signed-api.md`
- WebSocket/live streaming → `websocket-subscriptions.md`, `operations.md`
- DB/schema → `persistence.md`
- provider execution/config → `model-providers.md`
- verbs, callables, tool documents (`agents/protocol/src/tool-registry.ts`, `tool-documents.ts`) → `tools.md`,
  `security.md`
- new vocabulary for a mechanism → `glossary.md`, then use its words everywhere else
- desktop workflow/rendering → `desktop-ui.md`
- security/auth/secrets/logging → `security.md`
- major milestone completed → `implementation-history.md`, `roadmap.md`
- future work discovered → `future-projects.md`, `roadmap.md`
- new doc file → link from `readme.md`

Before finishing, run:

```bash
rg -n "TODO|not implemented|future|roadmap|Anthropic|Google|StopSession|nonce|KMS" agents/docs
```

Then confirm references are intentional and current.

## Manual acceptance checklist

After core changes:

1. Start agents server.
2. Start desktop.
3. Open Agents.
4. Confirm health online.
5. Configure OpenAI provider.
6. Create agent.
7. Create/open session.
8. Send message.
9. Confirm WebSocket subscription succeeds.
10. Confirm assistant streams as markdown.
11. Confirm final message persists after refresh.
12. Ask it to `read` a URL, then to `read ~/tools/` and `read ~/memory/`.
13. Confirm tool call/result events appear, and that a `call` for an unexpanded tool comes back as that tool's contract
    rather than an error.
14. Run a verb yourself from the composer's wrench palette; confirm the result lands on the log with a "You" chip and
    that the agent's next turn sees it.
15. Give it a task worth a checklist and a delegation; confirm the run card shows the plan, the child attaches to the
    running step, and the parent resumes with the child's result.
16. Reload the session page and confirm the durable session events are still visible.

## Known validation caveat

`pnpm audit` fails today because of existing repo dependency advisories unrelated to this feature. Report it honestly;
do not mark it as passed unless fixed.
