---
name: Code map
summary: Which file holds what in the app environment under apps/, its protocol package and the shared agents UI, and which test file covers each area.
---
This page is a map of the code behind [Seed Agents](../agent.md): the [app environment](../software/app-environment.md) server in `apps/`, the protocol package it shares with its clients, and the agents UI the Seed apps render. Use it to find where a behaviour lives before you change it. [Development](./development.md) has the commands and the step lists for common changes, and [The Seed software](../software.md) maps the rest of the repository.

# The service, in apps/ <!-- id:l1qGFiv- -->

`apps/` is its own Bun workspace. It takes the frontend packages it uses through `file:` dependencies. <!-- id:I1toG_st -->

- `src/main.ts`: the Bun HTTP and WebSocket server, CORS, the webhook route, health and version, live event fan-out. <!-- id:6Mgrjc3y -->
- `src/api-service.ts`: the heart of the service: action dispatch, persistence operations, the model turn on Pi Durable (`#runPiAgent`), the verb implementations, the Space index, trigger firing, subscription verification. <!-- id:3mdc_Y9h -->
- `src/durable-session.ts`: the per-session Pi Durable store: the file system that keeps it in the database, how a harness is opened over it, the sync document, and the tracker that turns committed partials into text deltas. See [durable sessions](../agent/durable-sessions.md). <!-- id:5hgrcO27 -->
- `src/auth.ts`: signed envelope verification, the five-minute timestamp window, [capability](../protocol/permissions.md)-based delegation. <!-- id:o3piFt7L -->
- `src/cbor.ts`: [DAG-CBOR](../protocol/blobs.md) request and response helpers and the protocol version header. <!-- id:rfRSsgr7 -->
- `src/config.ts`: every environment variable and CLI flag, with defaults. <!-- id:LswE9nei -->
- `src/sqlite.ts` and `src/sqlite-schema.sql`: open, schema gate, migrations; the canonical schema. <!-- id:kpAyOzjy -->
- `src/runs.ts`: durable [run](../agent/runs.md) records and the dispatch queue: leases, fair-share claiming, retries, cancellation cascade, timer wakes. <!-- id:4vcGWyxX -->
- `src/run-events.ts`: waiting runs and what wakes them. <!-- id:kGbbvqL6 -->
- `src/workflow-host.ts`: the QuickJS script engine: lint, realm prelude, journaled effect pump, replay; `src/workflow-worker-host.ts` runs it in a worker behind a flag. <!-- id:TaUFITTv -->
- `src/tool-documents.ts`: tools as content-addressed [tool documents](../agent/tool-document.md): the lambda ABI, builtin materialization, the MCP projection, authoring validation, contract markdown. <!-- id:p-4s5Rp2 -->
- `src/mcp.ts`: remote [MCP servers](../agent/mcp.md): connect, discover, proxy, the lazy per-run connection pool. <!-- id:xfcQtnXV -->
- `src/web-tools.ts`: self-hosted `web_search` and the tiered web reader behind `read https://…`. <!-- id:8YgK0pIj -->
- `src/agent-memory.ts`: the per-agent memory filesystem and the signed memory actions. <!-- id:T-vsI77Q -->
- `src/code-exec.ts`: sandboxed execution in microsandbox microVMs, boot-per-call and the warm pool. <!-- id:asTciXkg -->
- `src/activity-monitor.ts`, `src/activity-triggers.ts`, `src/schedule-monitor.ts`, `src/schedule-triggers.ts`: the [trigger](../agent/triggers.md) monitors and matching. <!-- id:UIBmluxQ -->
- `src/provider-oauth.ts`: the ChatGPT subscription sign-in flow. <!-- id:TqJfEvj- -->
- `src/json-schema.ts`: the bounded JSON Schema validator for typed results and authored contracts. <!-- id:4scILU9z -->
- `src/perf.ts`, `src/session-perf.ts`: the latency recorder behind the `perf` endpoints. <!-- id:66v3Od0T -->
- `src/protocol-compat.ts`, `src/protocol-surface.ts`: shims for clients on an older protocol version, and the surface snapshot the CI gate diffs. <!-- id:jf1NH6Pm -->
- `e2e/run.ts` and `e2e/live-gate.ts`: the record and replay model gate, and the live gate against a real server and model. <!-- id:EDMyrsOj -->

# The protocol package, in apps/protocol/

- `protocol/src/index.ts`: the canonical protocol types for actions, responses, session events, and WebSocket events, as the private package `@seed-hypermedia/apps-protocol`; `protocol/PROTOCOL.md` holds the versioning rules and changelog. <!-- id:wuXFGuu3 -->
- `protocol/src/tool-registry.ts`: the verbs and the callable tools: model-facing descriptions, JSON schemas, render metadata. Every word of a description is prompt. The same registry drives tool-row rendering and the wrench palette's forms in the UI. <!-- id:m4xyW-wr -->
- `protocol/src/write-guides.ts`: the per-resource guides an agent reads at `~/tools/write/<resource>`. <!-- id:ljPi4l8J -->
- `protocol/src/delegation.ts`, `protocol/src/reasoning.ts`, `protocol/src/model-capabilities.ts`: thoroughness presets, the reasoning-level matrix, image-input support. <!-- id:sbhHJvWe -->

# The shared UI <!-- id:_QMM36jW -->

The desktop app and the web app render the same screens from `frontend/packages/ui/src/agents/`. [In the app](../agent/in-the-app.md) describes what the screens do.

- Pages: `detail.tsx`, `session.tsx`, `run.tsx` (one run's status, work, tool calls, code, and activity) and `header.tsx`. <!-- id:yPdOBjWR -->
- The assistant panel: `assistant-panel.tsx` with `assistant-selection.ts`, `assistant-session-ref.ts`, and `assistant-window-context.ts`.
- Pieces: `dialogs.tsx`, `mcp-servers.tsx`, `memory.tsx`, `trigger-types.tsx`, `user-tool-commands.tsx`, `run-card.tsx`, `run-work.tsx`, `run-parked-actions.tsx`, `continuation.tsx`, `session-children.tsx`, `sessions-feed.tsx`, `new-session-composer.tsx`, `prompt-editor.tsx`, and `message-rendering.tsx`.
- Data: `models.ts` holds every React Query hook and the signed subscriptions. `client.ts` signs and sends actions and builds server, WebSocket, and webhook URLs. `agent-tools.ts` holds the grant names and defaults. `agent-session-rows.ts` turns events into rows. `provider-registry.ts` holds the provider metadata. `../site-agents.ts`, outside the agents chunk, finds a space's agents through its mount documents.
- `platform.ts` is the seam each app implements: signing, navigation, storage.
- The desktop's platform implementation, `frontend/apps/desktop/src/agents-platform.ts`, signs through the daemon. <!-- id:VxFQrOGl -->
- On the web, `frontend/apps/web/app/routes/hm.agents.$.tsx` mounts the pages, `web-assistant-panel-content.tsx` mounts the panel, and `web-agents-platform.ts` signs with the browser's device key and the [capability](../protocol/permissions.md) the [vault](../software/vault.md) issued at [sign-in](../build/sign-in.md). <!-- id:20Vt6Tin -->
- `frontend/packages/shared/src/routes.ts` defines the `agent` (with `tab`, `triggerId`, `memoryPath`), `agent-session`, and `agent-run` routes. `frontend/packages/shared/src/utils/agents-routing.ts` maps them to the web URLs `/hm/agents/agent/<id>?server=&tab=&trigger=&file=`, `/hm/agents/session/<id>?server=&agent=`, and `/hm/agents/run/<id>?server=&agent=`, and back, so a copied web link opens in the desktop app. <!-- id:f8zqWJaA -->
- `frontend/packages/apps-ui/` packages these screens for apps outside the repository: one provider implements the platform seam from a host's server URL and signer, and the build bundles the shared code. See [Embedding the agents UI](../build/apps-ui.md). <!-- id:OaR0RBa8 -->

# Shared Hypermedia code

The service reuses Hypermedia behaviour from [`@seed-hypermedia/client`](../build/sdk.md): `resource-read.ts` (`resolveIdWithClient`, shared with the [CLI](../build/cli.md)), `hm-resolver.ts`, `blocks-to-markdown.ts` and `markdown-to-blocks.ts`, `explore-query.ts`, and the blob signing and DAG-CBOR primitives (imported through the `@shm/shared/blobs` and `@shm/shared/cbor` re-exports). <!-- id:MF4Ylcua -->

# Test map <!-- id:nszQ78y6 -->

The whole service suite runs from `apps/` with `bun test`. The test files sit beside the source in `apps/src/`. <!-- id:QcZ8YChE -->

- `api-service.test.ts`: the big one: actions, ownership, sessions, delegation, obligations, plans. <!-- id:v1WA7PUZ -->
- `durable-session.test.ts`: the durable session runtime: one conversation across turns, the byte-stable prompt prefix, a turn resumed from its checkpoint after a process death, a lost store rebuilt from the log. <!-- id:Bad3WLee -->
- `verbs.test.ts`: the five verbs: address dispatch, touch-expand, promotion, user-invoked verbs. <!-- id:IEq07SB6 -->
- `tool-documents.test.ts`: CIDs, builtin materialization, lambda authoring validation. <!-- id:1H4sSkuE -->
- `runs.test.ts`, `run-time.test.ts`: queue claiming, leases, sweeps, parks and wakes. <!-- id:caikMvwb -->
- `workflow-host.test.ts`, `workflow-worker.test.ts`: the script engine: lint, journal replay, fuel and caps, the worker transport. <!-- id:fj1mr_e1 -->
- `activity-triggers.test.ts`, `activity-conditions.test.ts`, `activity-monitor.test.ts`, `trigger-events.test.ts`, `activity-trigger-race.test.ts`, `schedule-triggers.test.ts`: trigger matching, compound conditions, the monitor's watermark, firing idempotency, the comment and citation sibling race. <!-- id:fTK3pA_y -->
- `agent-memory.test.ts`, `session-attachments.test.ts`, `code-exec.test.ts`, `exec-pool.test.ts`, `exec-verify.test.ts`, `web-tools.test.ts`, `agent-tools-api.test.ts`, `mcp.test.ts`, `session-continuation.test.ts`, `write-link-validation.test.ts`. <!-- id:tC2RMQQo -->
- `auth.test.ts`, `sqlite.test.ts`, `main.test.ts`, `config.test.ts`, `json-schema.test.ts`, `poll-loop.test.ts`, `provider-oauth.test.ts`, `protocol-surface.test.ts`, `statements.test.ts`, `perf.test.ts`, `session-perf.test.ts`. <!-- id:-392qrQH -->
- `e2e-replay.test.ts` shells out to `e2e/run.ts`, the replay model gate. While the file `e2e/recordings/STALE.md` exists the replay skips and exits green, so a green run is not model-gate coverage. Recording fresh cassettes and deleting that file restores the gate. <!-- id:cLhLv7ws -->

Frontend: the shared UI's agents tests live in `frontend/packages/ui/src/__tests__/`, the desktop's in `frontend/apps/desktop/src/__tests__/`, and the web app's in `frontend/apps/web/app/__tests__/`. New page or hook tests belong beside those. <!-- id:9Bb25FAA -->

[Testing the app environment](./testing-the-app-environment.md) explains the suites and the gates in full.

# See also

- [Development](./development.md), for commands, conventions and recipes.
- [Testing the app environment](./testing-the-app-environment.md).
- [App environment](../software/app-environment.md), the map page of the program.
- [How it works](../agent/how-it-works.md), the architecture the files implement.
- [Contributing](./contributing.md), for the rest of the repository.
