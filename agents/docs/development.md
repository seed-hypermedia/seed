# Development

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

Agents:

- `agents/src/auth.test.ts`
- `agents/src/api-service.test.ts`
- `agents/src/sqlite.test.ts`
- `agents/src/main.test.ts`

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

1. Edit `sqlite-schema.sql`.
2. Update migration/version logic in `sqlite.ts`.
3. Add migration and fresh-init tests.
4. Update `persistence.md`.
5. Do not silently accept unknown/future versions.

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
- tools → `tools.md`, `security.md`
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
12. Ask `read` to read a URL.
13. Confirm tool call/result events appear.
14. Open `/agents` inspector and confirm session events are visible.

## Known validation caveat

`pnpm audit` fails today because of existing repo dependency advisories unrelated to this feature. Report it honestly;
do not mark it as passed unless fixed.
