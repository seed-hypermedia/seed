---
name: The Harness — Build Log
summary: Running log of the autonomous harness build; updated at every checkmark
---
# The Harness — Build Log <!-- id:T3u7XjtL -->

Running log of the autonomous build. Newest entries first. Each checkmark entry links the branch,<br>what was verified, and what Eric should test. Plan: [harness/plan](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/harness/plan). <!-- id:8mAFdP4z -->

## 2026-08-12 pre-dawn — ✅ THE NIGHT SHIFT: M4 + M5 + UX + the bus <!-- id:HDKDucaH -->

Committed across the stack (locally; NOTHING pushed): elegant orchestration UI with narrated<br>ctx.call + glanceable clickable tool rows; the step-id join (children survive plan renames —<br>proven live by a model renaming its step twice unprompted); execute grows first-class TypeScript<br>and authored lambdas RUN (documented ABI, both-edge validation, grant-gated); M5 time (event<br>waits, SignalRun, continueAsNew, budget-pause) with one-click Answer/Resume on parked cards; the<br>M6 event-bus subset (run-completed source, wake continuation, loop-guarded). Live-gated against<br>the real subscription server all night: the serial-parallel investigation (measured 3x3x3),<br>two deep wiring bugs found and fixed, a stalled dev-server lane caught and healed before morning.<br>Suites: agents 262/0 · desktop 622/0 · 01-verbs 222/0. Day queue: M6 document cut + consent,<br>stack rebase, F5 503-retry, run-card polish. Full detail: OVERNIGHT-PLAN.md + reviews/. <!-- id:TgkQD0Ik -->

## 2026-08-12 — ✅ M3 CHECKMARK: the symmetric log <!-- id:oRnm8zBi -->

`harness/03-symmetric-log` complete in its worktree (three story commits; NOT pushed). <!-- id:Bs2tVxUm -->

<!-- id:SRN6xte2 -->
- **The user holds the same verbs.** InvokeSessionTool runs read/write/call as you, through the <!-- id:wA_3Bxyu -->

\  agent's own dispatchers and grants; calls and results land actor-stamped on the shared log<br>  (failures too — a failed attempt is context). The agent reads your actions as tagged ground<br>  truth on its next turn. Desktop: wrench palette with schema-generated forms, "You" chips on<br>  user-run rows, WS appends as the only source of truth. <!-- id:waM4sAHg -->

<!-- id:bke-dYpF -->
- **Review found and killed two compounding critical bugs**: a session-bricking replay orphan <!-- id:sR_is6h0 -->

\  (synthetic results for interrupted user calls) with a poison guard for crash-era history, and a<br>  one-directional live-run guard (now bidirectional). Plus injection hardening: user-action<br>  payloads escape tag-closing brackets so fetched content can't forge trusted frames. <!-- id:sBK3xYIJ -->

<!-- id:KrSZtULO -->
- Gates: agents 231/0, desktop 266/0, typechecks clean. 10 review findings dispositioned. <!-- id:R8ENE8dp -->
- Review doc + three-minute test: `agents/docs/harness/reviews/03-symmetric-log.md`. <!-- id:XVLFgLzj -->
- Next: M4 — execution cleanup (execute {runtime, code}, TS runner, callable lambdas). <!-- id:vz5Vkd68 -->

## 2026-08-12 — ✅ M2 CHECKMARK: tools as documents <!-- id:8PjKNJ6_ -->

`harness/02-tools-as-docs` complete, verified, committed locally (four story commits; NOT pushed). <!-- id:LLB_X9Fy -->

<!-- id:pBobIByl -->
- **Every tool is a document**: per-agent `tool_documents` rows, canonical DAG-CBOR + CIDv1 (the <!-- id:gCYCfxl4 -->

\  network's own blob encoding). Builtins upsert idempotently by contract CID; agents can AUTHOR<br>  tools (`write ~/tools/<name>`) with hard validation — callable once M4 wires the sandbox. <!-- id:RZAztgA6 -->

<!-- id:NZI4_d-5 -->
- **The Space index**: one cached, byte-budgeted `<space>` block per system prompt (tools, memory <!-- id:86Fa6130 -->

\  top level, own triggers), invalidated at every mutation site — retires the per-turn memory walk. <!-- id:v4HXdBNH -->

<!-- id:swjxA2O4 -->
- **Touch-expand is durable and derived**: reading a contract (or calling a tool) promotes it to a <!-- id:1Oyk2SQs -->

\  first-class provider tool for the rest of the thread, reconstructed purely from transcript<br>  events on resume/restart. <!-- id:oF2VlQu7 -->

<!-- id:vwBazeon -->
- **Adversarial review paid off again**: 11 confirmed findings fixed, including a real security <!-- id:MnInpeYM -->

\  hole (hallucinated tool names reaching Pi's host bash via the promotion allowlist — now strictly<br>  intersected with enabled callables) and the restoration of read-only agents via an explicit<br>  `publish` grant with a desktop toggle (legacy write-group configs honored). <!-- id:r3wKJbJy -->

<!-- id:_l9oTj0B -->
- Gates: agents 230/0, desktop 259/0, typechecks clean. <!-- id:cMVzx0i0 -->
- Review doc + three-minute test: `agents/docs/harness/reviews/02-tools-as-docs.md`. <!-- id:DKF15cgV -->
- Next: M3 — the symmetric log (actor field, user tool calls on the shared log, schema forms). <!-- id:w6tXIni3 -->

## 2026-08-11 night — ✅ M1 CHECKMARK: the five verbs <!-- id:umdRcXPD -->

`harness/01-verbs` is complete, verified, and committed locally (five story commits; NOT pushed). <!-- id:VmaWZ8UA -->

<!-- id:EBNjzRxs -->
- **All gates green**: agents suite 221/0 (no hangs), desktop unit suite 259/0, both typechecks <!-- id:-9UcBbL4 -->

\  clean, 14 dedicated verb-dispatcher unit tests with hand-built mocks. <!-- id:8WhPFIJl -->

<!-- id:0Y2jAWJL -->
- **Blind simulated-model gate passed** all six scenarios; its 49 guessed-contract items drove a <!-- id:fBLYclnB -->

\  description-tightening pass (result shapes, memory semantics, script-side delegation behavior). <!-- id:5_oBQMnX -->

<!-- id:fCmrX-FE -->
- **Adversarial review (high effort)**: 14 verified findings, all dispositioned — including one <!-- id:mTv0zejw -->

\  confirmed critical (scripts had no path to callable tools) plus nine correctness fixes: legacy<br>  execute\_code alias, delegate detached-path validation, write update-action contract, child<br>  tool-narrowing base, trigger reply instructions, dead title-tool prompt, https hypermedia-first<br>  fallback narrowing, alias-collision-proof options.input passthrough, thread truncation marker. <!-- id:Uy-LbEsP -->

<!-- id:mmhF8tSm -->
- **Headline**: provider tool surface 28,886 bytes / 23 tools → 8,483 bytes / 5 verbs (−71%). <!-- id:W9y-J-gO -->
- Review doc with Eric's five-minute test script: `agents/docs/harness/reviews/01-verbs.md`. <!-- id:rlzkkbuE -->
- Next: M2 — tools as documents (Space tree, byte-budgeted index, touch-expand pins). <!-- id:efzB5_R6 -->

## 2026-08-11 evening — M1 core landed, verification in flight <!-- id:PqXiiNPl -->

The five-verb collapse is implemented on `harness/01-verbs` (local only — no pushes, per Eric): <!-- id:Vf3Uir3D -->

<!-- id:WKmWtL-L -->
- **Protocol registry rewritten**: `seedVerbRegistry` (read, write, call, delegate, plan + hidden <!-- id:U8r6Pu-W -->

\  return\_result) and `callableToolRegistry` (search, web\_search, navigate, execute) replace the<br>  25-tool monolith. Contract helpers `toolSummaryLine`/`toolContractMarkdown` power listings and<br>  touch-expand. <!-- id:IvxCsBqC -->

<!-- id:rP28eG4N -->
- **Headline number**: the provider-facing tool surface dropped from 28,886 bytes / 23 tools to <!-- id:-qjOhpIQ -->

\  **8,483 bytes / 5 verbs** — a 71% cut in always-on prompt weight, before M2's index work. <!-- id:xa4tguCo -->

<!-- id:TBfU8Fx9 -->
- **Address-polymorphic dispatch**: one `read` over \~/memory, \~/tools (contracts + listings), <!-- id:WqpiOH0F -->

\  hm://, ipfs://, https://, activity:, attachment:, thread:, run:. One `write` over memory<br>  (content/delete/fromUrl/fromAttachment), ipfs:// publishing, and hm:// documents (create,<br>  update, comment, move, redirect, delete, fork — mapped onto the existing signed command<br>  handlers). `call` validates against the target contract and answers a miss with the contract<br>  itself (touch-expand), never a dead error. <!-- id:qcIjEuAb -->

<!-- id:hCc2sKH3 -->
- **One delegation verb**: `delegate` routes awaited model children (verbatim-markdown `brief`), <!-- id:l3byeM1y -->

\  script children (`script` = journaled QuickJS module), and detached children (`await: false`).<br>  Scripts gained `ctx.delegate` (ctx.agent stays as a synonym on the same journal op — old<br>  journals replay byte-identically). The three name-filter chains in the service are deleted. <!-- id:tbePWzam -->

<!-- id:3Kzbn5-v -->
- **Testing** (Eric's directive: manually create mocks): new `src/verbs.test.ts` — 14 unit tests <!-- id:BB57QwLm -->

\  driving the three dispatchers through a hand-built context (temp memory dir, in-memory SQLite,<br>  spy callbacks, fake code executor, per-test fetch mocks). Stable suites green: 146 tests across<br>  runs, workflow-host, verbs, code-exec, agent-memory, attachments, json-schema, web-tools,<br>  reasoning, triggers, auth, poll-loop, provider-oauth. <!-- id:CMFyWnwU -->

<!-- id:VygrkcIa -->
- **In flight**: a forked agent is sweeping `api-service.test.ts`/`main.test.ts` (mocked model <!-- id:NplIdAU1 -->

\  scripts still speak the old tool names — they loop until per-test timeout, which is exactly how<br>  the sweep finds them); a second agent is sweeping the desktop/shared-UI renderers. The gpt-5-mini<br>  cassettes are declared stale (`e2e/recordings/STALE.md`, replay skips loudly, exit 0) pending a<br>  re-record with live credits; the blind simulated-model gate runs after the sweeps land. <!-- id:cNtMameF -->

## 2026-08-11 — M0 complete, M1 started <!-- id:1gE3TT8F -->

<!-- id:lauGTs27 -->
- **M0 done.** Rebased `feat/agent-workflows` onto main (three conflicts resolved against the merged <!-- id:gF81kp-u -->

\  OAuth PR #942; agents suite 63+12 green), committed the implementation plan, opened checkmark<br>  branch `harness/01-verbs`. <!-- id:kok3wl8p -->

<!-- id:IpVWIryN -->
- Published the plan and this log to the Hypermedia network. <!-- id:IZSK1RDn -->
