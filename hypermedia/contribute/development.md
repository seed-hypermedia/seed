---
name: Development
summary: This page shows how to run, check and change the app environment and its shared UI, with the conventions to follow and a step list for each common change.
---
This page is for people and coding agents who change the code behind [Seed Agents](../agent.md). That code is the [app environment](../software/app-environment.md) server in `apps/`, and the agents UI that the [desktop app](../software/desktop.md) and the [web app](../software/web.md) share. The page says how to run and check them, which conventions to follow, and which steps to take for each common change. <!-- id:K7JAYkEv -->

Read these first:

- The root `AGENTS.md`.
- `apps/AGENTS.md`, for the server. Its two main rules: use Bun only, never pnpm, and run `bun check && bun test` before every commit.
- `frontend/AGENTS.md`, for UI work.

Three other pages go with this one. [Contributing](./contributing.md) has the setup of the repository. [Code map](./code-map.md) says which file holds what. [Testing the app environment](./testing-the-app-environment.md) explains the test suites and gates.

# Commands <!-- id:72a6F9hI -->

Start the whole stack in one mprocs window. It has one pane for each process: the Docker web backends, the desktop app, the web app, the app environment and others. `q` stops everything. <!-- id:45rcP_oD -->

```bash <!-- id:kTpugFCl -->
./dev up
```

Start the app environment alone: <!-- id:iBra6R5G -->

```bash <!-- id:4pr04rmj -->
direnv exec . bash -lc 'cd apps && bun src/main.ts'   # plain
direnv exec . bash -lc 'cd apps && bun run dev'       # hot reload, dev web backends, subscription auth on
```

Check the server: <!-- id:w21cku7O -->

```bash <!-- id:92q4r3gT -->
direnv exec . bash -lc 'cd apps && bun check && bun test'   # typecheck + formatter, then the suite
direnv exec . bash -lc 'cd apps && bun run test:build'      # the compiled binary boots
direnv exec . bash -lc 'cd apps && bun run test:docker'     # the image boots
direnv exec . bash -lc 'cd apps && bun run test:trigger'    # the real server, mention trigger fires once
direnv exec . bash -lc 'cd apps && bun run test:outbox'     # the real server, effect outbox across kill -9, disk floor, ENOSPC
direnv exec . bash -lc 'cd apps && bun run protocol:check'  # the protocol surface did not change silently
```

Check the frontend: <!-- id:z1RLpVSN -->

```bash <!-- id:J9Xm3IKX -->
direnv exec . bash -lc 'pnpm typecheck'
direnv exec . bash -lc 'pnpm test'
direnv exec . bash -lc 'pnpm format:check'
```

Build the deployment image and run the desktop app: <!-- id:LXwDSl2S -->

```bash <!-- id:L-JSfuz3 -->
docker build -t seedhypermedia/apps:dev . -f ./apps/Dockerfile
direnv exec . bash -lc './dev run-desktop'
```

CI publishes the image as `seedhypermedia/apps`, and it pushes each tag under the name `seedhypermedia/agents` too.

# Local URLs <!-- id:T63k7HLv -->

`.env.vars` sets `SEED_APPS_HTTP_PORT=3051` in the development shell. So the development server never shares a port with a packaged build, which uses 3050. <!-- id:TsG-jsNo -->

The API is under the prefix `/hm/api/apps`. The same routes answer under `/hm/api/agents`, the older prefix that released clients and existing webhook URLs use. [Endpoints and health](../operate/endpoints-and-health.md) lists every path, including the older ones with no prefix.

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

- Normalize input from users and from the network where it enters the API. Internal code expects normalized values. <!-- id:RS0y-zWC -->
- Never hold a SQLite write transaction around a model, provider, or tool network call. <!-- id:TACnz28O -->
- Never log secrets, signed bodies, or full session or model content. <!-- id:bdGZN4X_ -->
- The protocol types are in `apps/protocol/src/index.ts`. Do not write copies of them in the desktop app or the server. A change to the protocol must pass `bun run protocol:check`. A breaking change raises the protocol version, by the rules in `apps/protocol/PROTOCOL.md`. <!-- id:oaOlwOvA -->
- A response that describes a model provider never includes its secrets. <!-- id:v1_cpG9V -->
- Prefer broad tests that run real behaviour. Prefer an existing file over a new, very small module. <!-- id:GMnMav_E -->

# Adding an API action <!-- id:Yusrx60B -->

1. Add the request and response types to `apps/protocol/src/index.ts`. <!-- id:68bp4RE3 -->
2. Handle it in `Service.message()`. Validate the input and check that the [account](../protocol/identity.md) owns what it touches. <!-- id:ABZN2ZuZ -->
3. If a client retry could repeat a side effect, make the action safe to repeat. <!-- id:iKsv7l1o -->
4. Emit service events if connected clients need the update. <!-- id:CROBrqV1 -->
5. Add the hook in `models.ts` and any UI. <!-- id:EUHuuzzz -->
6. Add tests, run `protocol:check`, and update the [signed API](../build/signed-api.md). <!-- id:_S0EUw3S -->

# Adding a WebSocket event <!-- id:Hu97ZELv -->

1. Extend `AgentWSEvent` in the protocol package. <!-- id:b0Jmm1k2 -->
2. Emit the service event where the change happens. Map it in `main.ts`, in the code that sends events to clients. <!-- id:8xCYhLLy -->
3. Handle it in the subscription hook in `models.ts`. <!-- id:sLVISokW -->
4. Update [WebSocket subscriptions](../build/websocket-subscriptions.md). <!-- id:kSXSMRz- -->

# Changing the database <!-- id:X7HQ2JCB -->

1. Edit `sqlite-schema.sql`, the fresh-install baseline. <!-- id:1PYtDkPx -->
2. Add the migration at the **start** of the `migrations` array in `sqlite.ts`. The code reverses the array, so the newest entry runs last. Never edit or reorder a migration that has shipped. <!-- id:tlUdf6HK -->
3. Keep the two equal: an old baseline plus every migration must produce the schema in `sqlite-schema.sql`. `sqlite.test.ts` builds an old baseline, applies the migrations, and checks the tables and columns that result. Add yours to those checks. The test does not compare the whole schema. <!-- id:x-zqYDyR -->
4. Never accept an unknown or newer schema version without an error. <!-- id:P3x_iSOP -->
5. Update [persistence](../operate/persistence.md). <!-- id:_wvDYz61 -->

# Changing the model-facing surface <!-- id:bS7bGT8I -->

The model-facing surface is everything the model sees as a tool. It is only the verbs: the [five working verbs](../agent/tools.md), plus `status` and `continue_session`. A new ability arrives as an address, an option or a [callable](../agent/callables.md). It never arrives as another verb without a design discussion. <!-- id:c9hqLvkf -->
  1. A new **address form** for `read` or `write` goes in two places: the description of the verb in the tool registry, and the address handling in `api-service.ts`. The description is prompt text, so edit it with that care. <!-- id:JkzIH8Jt -->
  2. A new **callable** goes in `callableToolRegistry`, with `runtimes` that include `agent-service`. The model reaches it through `call`. Never add it to the provider payload directly. The next listing turns it into a [tool document](../agent/tool-document.md) for every agent, and the change of its [CID](../cid.md) is the new version. <!-- id:3CFRldLu -->
  3. Keep touch-expand working: a `call` that is wrong, or that names a tool the model has not opened, answers with the contract and never with an error. <!-- id:FtdrC1Vt -->
  4. Filter anything [promoted](../agent/promotion.md) into the provider payload against the callables the agent has turned on. Promotion comes from durable events. Without the filter, a tool name that the model made up could turn on a real tool. <!-- id:5YLbjR8m -->
  5. [Grants](../agent/grants.md) are the callable set, `publish`, and the enabled MCP servers. Do not add a grant for a verb. <!-- id:5G20WmgP -->
  6. Update [tools](../agent/tools.md) and [security](../agent/security.md). If you made a new word for the mechanism, add a term page and list it in the [glossary](../agent/glossary.md). <!-- id:SF7b6DXI -->

# Adding a provider <!-- id:OTf3ZmOJ -->

1. Add the `PROVIDER_SPECS` entry in `api-service.ts` and the matching `PROVIDER_METADATA` entry in the UI's `provider-registry.ts`. <!-- id:V6_ROH-n -->
2. If the model has reasoning levels, add its generation to `reasoning.ts`, with a note on how you checked the levels. If it takes images, add it to `model-capabilities.ts`. <!-- id:_U7z8PjV -->
3. Keep the session lifecycle and the WebSocket partials working. Check that the entries of the durable store become `message`, `tool_call` and `tool_result` events in the right order. <!-- id:VrwStUJn -->
4. Add tests with a fake network for these cases: success, streaming, text that comes before a tool call, tools, a missing key, and provider errors. <!-- id:kuRYQE4J -->
5. Check that decrypted secrets stay in memory. They must never reach the durable store or a Pi auth file. <!-- id:cm0Swvpm -->
6. Update [model providers](../agent/model-providers.md). <!-- id:MImbwolq -->

# Changing a prompt

[What an agent is told](../agent/prompt.md) lists every source of model-facing text. When you change one:

1. When the behaviour should apply everywhere, change the shared instructions first. <!-- id:VOK56HfI -->
2. Keep what `#agentSystemPrompt()` builds small and in order. Every part you add uses context on every turn. <!-- id:UDqqI0c9 -->
3. To remind the model of the state at this moment, use a part that lasts one turn. To record something that happened, use a durable event. <!-- id:sSf6minb -->
4. If a new part wraps text that anyone but the server wrote, escape the text and add the part to the list of untrusted sources on that page. <!-- id:kiJ8l6rA -->
5. When the behaviour depends on tool use, update the tool descriptions in `apps/protocol/src/tool-registry.ts`. <!-- id:PjDSTL-L -->
6. Look at a live session through `GetSession.systemPromptMarkdown`, or in the system prompt dialog of the session. <!-- id:Owoth1sD -->

# Security checks for new work

[Security](../agent/security.md) explains the security model that these steps protect.

For every new action: <!-- id:axAWn385 -->
  1. Check the signature. <!-- id:7faLpQy_ -->
  2. Check that the signer may act for the account. <!-- id:dRwdiRcR -->
  3. Normalize the input where it enters. <!-- id:27CsEQc_ -->
  4. Limit every database query to what the account owns. <!-- id:NhmrAlp7 -->
  5. Remove sensitive data from what you return and log. <!-- id:UwLTwcN8 -->
  6. Add tests for a caller with no right and for a caller from another account. For an action on one agent, also test reader against writer, and pending against accepted. <!-- id:jG6YnMUV -->
  7. Decide what happens when the same request arrives twice. <!-- id:VqnyHsSW -->
  8. Decide which WebSocket clients receive the event. <!-- id:6RJAfdo7 -->

For every new tool or address form: <!-- id:CwIdOyUb -->
  1. Add or update the one registry entry in `apps/protocol/src/tool-registry.ts`. Then the prompt text, the input schema and the display data are reviewed together. <!-- id:QKpeyRPQ -->
  2. Decide the [grant](../agent/grants.md): the callable set, `publish`, or no grant. <!-- id:YbrvNPlW -->
  3. Validate the input where it enters the runtime. If it does not fit, return the contract. <!-- id:6-8VGr0S -->
  4. Limit the size of the output. <!-- id:A6KLJ63H -->
  5. If the tool can be promoted, check that the promotion filter still works. <!-- id:hjF1aWK3 -->
  6. If text that the model wrote goes back into the prompt inside a wrapper, escape it. <!-- id:0KW3vaxq -->
  7. Do not log sensitive data. <!-- id:hCefS6od -->
  8. Add tests for missing credentials and for provider or tool errors. <!-- id:DT_jTHUr -->

# Which page to update <!-- id:z1WePGfo -->

Documentation is part of the change. Update it in the same commit. <!-- id:_-pHvjIO -->
  - action or response semantics: [signed API](../build/signed-api.md) <!-- id:JxgMnXgd -->
  - WebSocket or streaming: [WebSocket subscriptions](../build/websocket-subscriptions.md), [endpoints and health](../operate/endpoints-and-health.md) <!-- id:hkQxRraI -->
  - schema or migrations: [persistence](../operate/persistence.md) <!-- id:Hs727B6M -->
  - provider execution or config: [model providers](../agent/model-providers.md) <!-- id:sXjohtq6 -->
  - verbs, callables, tool documents: [tools](../agent/tools.md), [security](../agent/security.md) <!-- id:RZ6Mkpxu -->
  - MCP servers: [MCP servers](../agent/mcp.md), [tools](../agent/tools.md), [security](../agent/security.md) <!-- id:6Ac5BAtk -->
  - triggers: [Trigger](../trigger.md), [triggers of an agent](../agent/triggers.md) <!-- id:XCxEaSCN -->
  - UI behaviour: [in the app](../agent/in-the-app.md) <!-- id:y6OaZfcV -->
  - prompts: [what an agent is told](../agent/prompt.md) <!-- id:UNhC5zAi -->
  - auth, secrets, logging: [security](../agent/security.md), [logs](../operate/logs.md) <!-- id:sUBDxAjI -->
  - environment variables, deployment: [configuration](../operate/configuration.md), [deploying](../operate/deploying.md), [environments](../operate/environments.md) <!-- id:g5CyreTk -->
  - files moved or added: [Code map](./code-map.md)
  - a new page: link it from [Seed Agents](../agent.md) or from the page it belongs under. These docs have no history page. Git has the history. <!-- id:cDUhtr1N -->

# Manual smoke test <!-- id:IijsWeYF -->

After a change to the core of the server, go through these steps by hand:

1. Start a server and the app. Set up a provider and create an agent. <!-- id:2-mCTqPr -->
2. Open a [session](../agent/session.md) and send a message. Check that it shows at once, that the subscription works, and that the reply streams as markdown. <!-- id:lasrcBtg -->
3. Ask the agent to read a Seed URL, and also a web URL on a [custom domain](../protocol/sites.md). Check that the row shows the target it resolved to. Then ask it to `read ~/tools/` and `read ~/memory/`. <!-- id:yDijYCVS -->
4. Check that a `call` of a tool the model has not opened comes back as the contract. <!-- id:QokFTRwA -->
5. Ask for a task with three or more steps and two [delegations](../agent/delegate.md). Check four things. The pinned card shows the checklist with both children side by side. Each child is attached to the step that is running. The parent continues with the results. The card becomes a fixed part of the transcript when the run ends. <!-- id:6gqbLXr0 -->
6. Ask the agent to write a tool for itself and call it. Check that the row shows under Custom tools. <!-- id:K_lfckOv -->
7. Type `/` in the message box and run Read. Check that the row has the You chip, and that the agent refers to the read on its next turn. <!-- id:gg9uksVt -->
8. Reload. Check that the transcript, the run cards and the state of the cards come back. <!-- id:fe2AgLbi -->

# See also <!-- id:zPiwykmo -->

- [Operating an app environment](../operate/operations.md) and [Configuration](../operate/configuration.md) <!-- id:n4QkH6sG -->
- [Environments](../operate/environments.md) <!-- id:xAKxp5eo -->
- [How agents work](../agent/how-it-works.md) <!-- id:koi4XoLt -->
- [Code map](./code-map.md)
- [Testing the app environment](./testing-the-app-environment.md)
- [Tools](../agent/tools.md) <!-- id:UZ1y3WVD -->
- [Persistence](../operate/persistence.md) <!-- id:Q6M0O-yD -->
- [App environment](../software/app-environment.md) <!-- id:cq7YdHE3 -->
- [Contributing](./contributing.md) <!-- id:PX0gDkk6 -->
