# The Harness — Glossary

## The three nouns

- **Space** — everything an agent _has_, as one addressable tree: `~/memory/` (its files), `~/tools/` (its tools),
  `~/triggers/` (its automations), `~/self` (its own definition, read-only), and later `~/plans/`. Configuration is
  content.
- **Log** — everything that _happened_ in a thread: an append-only sequence of events (messages, tool calls, results,
  plan updates), each stamped with an **actor**. It's a shared workspace log, not a chat transcript — you and the agent
  write to the same one.
- **Runs** — everything that _executes_. Every turn, child, and script is a run row in a tree; the table doubles as the
  dispatch queue. Waiting runs hold no resources ("waiting is free").

## The five verbs (the agent's — and your — whole tool surface)

- **read** — one verb, any address: `~/memory/…`, `~/tools/…`, `~/triggers/…`, `~/self`, `hm://…`, `ipfs://…`,
  `https://…`, `activity:`, `attachment:…`, `thread:…` (bare `thread:` lists and searches the account's conversations),
  `run:…`.
- **write** — the mirror: memory files, authored tools, triggers, hypermedia publishing (gated by the **publish
  grant**), IPFS.
- **call** — invoke a callable tool by name (`search`, `web_search`, `execute`, or an authored lambda). Wrong input
  returns the tool's **contract** instead of an error — that's **touch-expand**.
- **delegate** — spawn a child run: a **model child** (give it a **brief**) or a **script child** (give it a `script`).
  `await: false` = detached.
- **plan** — maintain the thread's visible checklist. Hidden from the log; rendered as the card.

## Delegation & orchestration

- **child** — a run spawned by delegate; a model child gets its own session (thread), a script child runs in the QuickJS
  engine.
- **brief** — the markdown task briefing that becomes a model child's first message _verbatim_. The prompt is the
  interface.
- **typed result / return_result** — a child spawned with an `output` schema must deliver its result through the
  `return_result` tool; validation errors bounce back for self-correction.
- **script / ctx** — a script child's world: `ctx.call(tool, input, {description})`, `ctx.delegate`, `ctx.parallel`,
  `ctx.step`, `ctx.plan`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.continueAsNew`. Deterministic: no clock, no randomness,
  every effect journaled.
- **journal** — a script run's durable effect record. Resume = replay source against journal; completed effects never
  re-execute. **Narration** (`{description}`) rides journal entries as display metadata, outside the replay key.
- **park / wait** — a run pausing without holding resources. Wait reasons: **children**, **timer**, **event**,
  **budget-pause**.
- **wake source** — whatever ends a park: children finishing, a timer, a **SignalRun** (the card's **Answer** button
  sends the run's `answerWith` signal), an activity event, or a human **Resume** on a budget pause.
- **continueAsNew** — a long-running script finalizing into a fresh successor run that keeps its _place_ (same parent,
  same call) but starts a clean journal. How day-scale loops stay bounded.

## Plans & attachment

- **step** — one checklist item, with a stable `id` and a human `label` (models rename labels freely; ids persist).
- **attachment** — a child spawned while a step is running belongs to that step; the step row _is_ the way into the
  child. Joined by **planStepId** (the stable id), label as legacy fallback.
- **batch step** — one running step owning a whole parallel batch of children.

## Tools

- **tool document** — every tool is a content-addressed document (DAG-CBOR, CID = version) in `~/tools/`: builtin
  (runtime binding), **lambda** (authored source, runs in the sandbox via `call`), or **mcp** (a projection of one tool
  on a remote MCP server, proxied to it via `call`).
- **MCP server** — a remote Model Context Protocol server connected per account, like a model provider, and enabled per
  agent (`definition.mcpServers`). Its tools appear as `<server>__<tool>` documents; connections open lazily per run.
- **contract** — a tool's full model-facing spec: description + input/output schemas. `read ~/tools/<name>` returns it.
- **Space index** — the compact `<space>` block in every system prompt: one line per tool, memory top level, active
  triggers. The agent always knows what it _could_ expand.
- **promotion** — once a tool's contract enters the transcript (read or called), it becomes a first-class provider tool
  for the rest of the thread — derived purely from durable events, so it survives restarts.
- **grants** — per-agent permissions: the callable set (search / web search / execute), **publish** (signed public
  writing), and the enabled **MCP servers**. Verbs are never grants; they're always on.

## Symmetric log

- **actor** — who did it: `user`, `agent`, `system`, `trigger`. Every event carries one.
- **wrench palette** — your tool button in the composer: run read/write/call yourself; results land on the log with a
  **"You" chip**, and the agent reads them as ground truth (`<user_action>` in its replay).

## Triggers & the bus

- **trigger** — standing configuration binding a **source** (schedule, comment, mention, site-update, **run-completed**)
  to a **continuation** (today: new thread, or **wake** a parked run). Readable and writable at `~/triggers/<name>`: the
  agent creates, edits, enables, and disables its own triggers directly. Trigger _documents_ (CID-versioned) are still
  the day package.
- **firing** — one trigger activation, deduped exactly-once; run-completed chains are loop-guarded (8 hops).

## Process terms (how this gets built)

- **checkmark** — a milestone branch, verified (suites + adversarial review + live gate) before you're asked to look.
- **live gate** — the scripted scenarios run against your real server with a real model (`agents/e2e/live-gate.ts`);
  enforced checks are deterministic properties, model behavior is _reported_.
- **the guide** — `HARNESS-TESTING.html`: every test case with exact prompts, expected outcomes, and honest verification
  markers.
