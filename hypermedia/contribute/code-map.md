---
name: Code map
summary: This page says which file holds what in the app environment under apps/, in its protocol package and in the shared agents UI, and which test file covers each area.
---
This page is a map of the code behind [Seed Agents](../agent.md). Use it to find the file that holds a behaviour before you change it. The code has three parts:

- The [app environment](../software/app-environment.md) server, in `apps/`.
- The protocol package that the server shares with its clients.
- The agents UI that the [desktop app](../software/desktop.md) and the [web app](../software/web.md) show.

[Development](./development.md) has the commands and the step lists for common changes. [The Seed software](../software.md) maps the rest of the repository.

# The server, in apps/ <!-- id:l1qGFiv- -->

`apps/` is its own Bun workspace. It gets the frontend packages it uses through `file:` dependencies, which copy them at install time. <!-- id:I1toG_st -->

- `src/main.ts`: the Bun HTTP and WebSocket server, CORS, the [webhook](../agent/webhooks.md) route, health and version, and the code that sends live events to clients. <!-- id:6Mgrjc3y -->
- `src/api-service.ts`: the centre of the server. It holds the handling of actions, the database operations, the model turn on Pi Durable (`#runPiAgent`), the code of the verbs, the index of an agent's [Space](../agent/space.md), the firing of [triggers](../trigger.md), and the check of subscriptions. <!-- id:3mdc_Y9h -->
- `src/durable-session.ts`: the Pi Durable store of each [session](../agent/session.md). It holds the file system that keeps the store in the database, the way a harness is opened over it, the sync [document](../protocol/documents.md), and the tracker that turns saved partials into text deltas. See [durable sessions](../agent/durable-sessions.md). <!-- id:5hgrcO27 -->
- `src/auth.ts`: the check of the [signed envelope](../blob.md) of each request (see [the signed API](../build/signed-api.md)), the five-minute window for its timestamp, and delegation by [capability](../protocol/permissions.md). <!-- id:o3piFt7L -->
- `src/cbor.ts`: the [DAG-CBOR](../schema/dag-cbor.md) helpers for requests and responses, and the protocol version header. <!-- id:rfRSsgr7 -->
- `src/config.ts`: every environment variable and CLI flag, with defaults. <!-- id:LswE9nei -->
- `src/sqlite.ts` and `src/sqlite-schema.sql`: opening the database, the schema version check and the migrations; and the schema itself. <!-- id:kpAyOzjy -->
- `src/runs.ts`: the durable [run](../agent/runs.md) records and the [run queue](../operate/run-queue.md): leases, fair-share claiming, retries, cancelling a run with its children, and wake-ups by timer. <!-- id:4vcGWyxX -->
- `src/run-events.ts`: waiting runs and what wakes them. <!-- id:kGbbvqL6 -->
- `src/workflow-host.ts`: the QuickJS engine that runs [scripts](../agent/script.md): the lint, the setup code of the script realm, the loop that runs effects and writes them to the [journal](../agent/journal.md), and replay. `src/workflow-worker-host.ts` runs the engine on a worker thread when a flag is set. <!-- id:TaUFITTv -->
- `src/tool-documents.ts`: tools as [tool documents](../agent/tool-document.md), each named by its [CID](../cid.md). It holds the interface of authored tools, the code that turns built-in tools and MCP tools into tool documents, the validation of a tool that an agent writes, and the markdown of a contract. <!-- id:p-4s5Rp2 -->
- `src/mcp.ts`: remote [MCP servers](../agent/mcp.md): connect, list tools, pass calls through, and the pool of connections that each run opens only when it needs one. <!-- id:xfcQtnXV -->
- `src/web-tools.ts`: `web_search` on a search backend that you host, and the web reader behind `read https://…`, which tries several methods in order. <!-- id:8YgK0pIj -->
- `src/agent-memory.ts`: the [memory](../agent/memory.md) file system of each agent and the signed memory actions. <!-- id:T-vsI77Q -->
- `src/code-exec.ts`: code execution in microsandbox microVMs, with a new VM for each call or a pool of VMs that are already started. <!-- id:asTciXkg -->
- `src/activity-monitor.ts`, `src/activity-triggers.ts`, `src/schedule-monitor.ts`, `src/schedule-triggers.ts`: the monitors that watch for trigger events, and the code that matches an event to a trigger. See [Triggers](../agent/triggers.md). <!-- id:UIBmluxQ -->
- `src/provider-oauth.ts`: the ChatGPT subscription sign-in flow. <!-- id:TqJfEvj- -->
- `src/json-schema.ts`: the JSON Schema validator, with fixed limits, for typed results and for the contracts of authored tools. <!-- id:4scILU9z -->
- `src/perf.ts`, `src/session-perf.ts`: the latency recorder behind the `perf` endpoints. <!-- id:66v3Od0T -->
- `src/protocol-compat.ts`, `src/protocol-surface.ts`: the code that keeps clients on an older protocol version working, and the snapshot of the protocol that CI compares against. <!-- id:jf1NH6Pm -->
- `e2e/run.ts` and `e2e/live-gate.ts`: the gate that replays recorded model answers, and the live gate against a real server and a real model. <!-- id:EDMyrsOj -->

# The protocol package, in apps/protocol/

- `protocol/src/index.ts`: the one set of protocol types for actions, responses, session events and WebSocket events. It is the private package `@seed-hypermedia/apps-protocol`. `protocol/PROTOCOL.md` holds the versioning rules and the changelog. <!-- id:wuXFGuu3 -->
- `protocol/src/tool-registry.ts`: the [verbs](../agent/tools.md) and the [callable tools](../agent/callables.md), with the descriptions the model reads, the JSON schemas and the display data. Every word of a description is prompt text. The UI uses the same registry to draw tool rows and the forms a person fills in to run a tool themselves. <!-- id:m4xyW-wr -->
- `protocol/src/write-guides.ts`: the guides, one for each kind of resource, that an agent reads at `~/tools/write/<resource>`. <!-- id:ljPi4l8J -->
- `protocol/src/delegation.ts`, `protocol/src/reasoning.ts`, `protocol/src/model-capabilities.ts`: the thoroughness presets, the table of reasoning levels for each model, and which models take images. <!-- id:sbhHJvWe -->

# The shared UI <!-- id:_QMM36jW -->

The desktop app and the web app show the same screens, from `frontend/packages/ui/src/agents/`. [In the app](../agent/in-the-app.md) describes what the screens do.

- Pages: `detail.tsx`, `session.tsx`, `run.tsx` (one run's status, work, tool calls, code, and activity) and `header.tsx`. <!-- id:yPdOBjWR -->
- The assistant panel: `assistant-panel.tsx` with `assistant-selection.ts`, `assistant-session-ref.ts`, and `assistant-window-context.ts`.
- Pieces: `dialogs.tsx`, `mcp-servers.tsx`, `memory.tsx`, `trigger-types.tsx`, `user-tool-commands.tsx`, `run-card.tsx`, `run-work.tsx`, `run-parked-actions.tsx`, `continuation.tsx`, `session-children.tsx`, `sessions-feed.tsx`, `new-session-composer.tsx`, `prompt-editor.tsx`, and `message-rendering.tsx`.
- Data: `models.ts` holds every React Query hook and the signed subscriptions. `client.ts` signs and sends actions and builds server, WebSocket, and webhook URLs. `agent-tools.ts` holds the [grant](../agent/grants.md) names and defaults. `agent-session-rows.ts` turns events into rows. `provider-registry.ts` holds the provider metadata. `../site-agents.ts`, outside the agents folder, finds the agents of a [space](../protocol/spaces.md) through its [mount](../agent/mounting.md) documents.
- `platform.ts` is the interface that each app fills in: signing, navigation, storage.
- The desktop app's version of that interface, `frontend/apps/desktop/src/agents-platform.ts`, signs through the [daemon](../software/daemon.md). <!-- id:VxFQrOGl -->
- On the web, `frontend/apps/web/app/routes/hm.agents.$.tsx` shows the pages and `web-assistant-panel-content.tsx` shows the panel. `web-agents-platform.ts` signs with the browser's [session key](../build/sign-in.md) and the capability that the [vault](../software/vault.md) gave it at sign-in. <!-- id:20Vt6Tin -->
- `frontend/packages/shared/src/routes.ts` defines the `agent` (with `tab`, `triggerId`, `memoryPath`), `agent-session`, and `agent-run` routes. `frontend/packages/shared/src/utils/agents-routing.ts` maps them to the web URLs `/hm/agents/agent/<id>?server=&tab=&trigger=&file=`, `/hm/agents/session/<id>?server=&agent=`, and `/hm/agents/run/<id>?server=&agent=`, and back, so a copied web link opens in the desktop app. <!-- id:f8zqWJaA -->
- `frontend/packages/apps-ui/` packages these screens for apps outside the repository. One provider component fills in the platform interface from the server URL and the signer that the host app gives it, and the build bundles the shared code. See [Embedding the agents UI](../build/apps-ui.md). <!-- id:OaR0RBa8 -->

# Shared Hypermedia code

The server uses Hypermedia code from [`@seed-hypermedia/client`](../build/sdk.md), the SDK: `resource-read.ts` (`resolveIdWithClient`, which the [CLI](../build/cli.md) uses too), `hm-resolver.ts`, `blocks-to-markdown.ts` and `markdown-to-blocks.ts`, `explore-query.ts`, and the code that signs [blobs](../protocol/blobs.md) and encodes DAG-CBOR. It imports the last two through `@shm/shared/blobs` and `@shm/shared/cbor`. <!-- id:MF4Ylcua -->

# Test map <!-- id:nszQ78y6 -->

`bun test`, run in `apps/`, runs the whole suite of the server. The test files are beside the source in `apps/src/`. <!-- id:QcZ8YChE -->

- `api-service.test.ts`: the largest file: actions, ownership, sessions, delegation, obligations, plans. <!-- id:v1WA7PUZ -->
- `durable-session.test.ts`: the durable session runtime: one conversation over several turns, a prompt prefix that stays the same byte for byte, a turn that continues from its checkpoint after the process dies, and a lost store built again from the [log](../agent/log.md). <!-- id:Bad3WLee -->
- `verbs.test.ts`: the five verbs ([`read`](../agent/read.md), `write`, `call`, `delegate`, `plan`): address handling, touch-expand, [promotion](../agent/promotion.md), and verbs that a user runs. <!-- id:IEq07SB6 -->
- `tool-documents.test.ts`: CIDs, built-in tools as tool documents, and the validation of authored tools. <!-- id:1H4sSkuE -->
- `runs.test.ts`, `run-time.test.ts`: claiming from the queue, leases, sweeps, and runs that wait and wake. <!-- id:caikMvwb -->
- `workflow-host.test.ts`, `workflow-worker.test.ts`: the script engine: lint, replay of the journal, fuel and limits, and the link to the worker thread. <!-- id:fj1mr_e1 -->
- `activity-triggers.test.ts`, `activity-conditions.test.ts`, `activity-monitor.test.ts`, `trigger-events.test.ts`, `activity-trigger-race.test.ts`, `schedule-triggers.test.ts`: trigger matching, conditions with several parts, the watermark of the monitor, firing only once, and the race between a [comment](../protocol/comments.md) and the [citation](../protocol/links-and-citations.md) it creates. <!-- id:fTK3pA_y -->
- `agent-memory.test.ts`, `session-attachments.test.ts`, `code-exec.test.ts`, `exec-pool.test.ts`, `exec-verify.test.ts`, `web-tools.test.ts`, `agent-tools-api.test.ts`, `mcp.test.ts`, `session-continuation.test.ts`, `write-link-validation.test.ts`. <!-- id:tC2RMQQo -->
- `auth.test.ts`, `sqlite.test.ts`, `main.test.ts`, `config.test.ts`, `json-schema.test.ts`, `poll-loop.test.ts`, `provider-oauth.test.ts`, `protocol-surface.test.ts`, `statements.test.ts`, `perf.test.ts`, `session-perf.test.ts`. <!-- id:-392qrQH -->
- `e2e-replay.test.ts` runs `e2e/run.ts`, the replay gate. While the file `e2e/recordings/STALE.md` exists, the replay skips and passes. So a passing run does not prove that the gate ran. To bring the gate back, record new cassettes and delete that file. <!-- id:cLhLv7ws -->

Frontend: the agents tests of the shared UI are in `frontend/packages/ui/src/__tests__/`, the desktop app's are in `frontend/apps/desktop/src/__tests__/`, and the web app's are in `frontend/apps/web/app/__tests__/`. Put new tests for pages or hooks beside those. <!-- id:9Bb25FAA -->

[Testing the app environment](./testing-the-app-environment.md) explains the suites and the gates in full.

# See also

- [Development](./development.md), for commands, conventions and recipes.
- [Testing the app environment](./testing-the-app-environment.md).
- [App environment](../software/app-environment.md), the map page of the program.
- [How agents work](../agent/how-it-works.md), the architecture the files implement.
- [Contributing](./contributing.md), for the rest of the repository.
