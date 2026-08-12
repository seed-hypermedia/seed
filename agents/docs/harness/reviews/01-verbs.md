# Checkmark review — M1: the five verbs (`harness/01-verbs`)

Status: **draft — verification in flight** (self-review and gate results land here before Eric is prompted).

## What changed

The 25-tool registry is replaced by five always-on verbs plus a callable-tool directory:

- `agents/protocol/src/tool-registry.ts` — rewritten. `seedVerbRegistry` = read, write, call, delegate, plan, hidden
  return_result. `callableToolRegistry` = search, web_search, navigate (assistant runtime), execute. `seedToolRegistry`
  remains as the merged name→metadata lookup for renderers. New helpers: `toolSummaryLine`, `toolContractMarkdown`.
- `agents/src/api-service.ts` —
  - `executeReadVerb` / `executeWriteVerb` / `executeCallVerb`: address-polymorphic dispatchers (exported for direct
    unit testing). read covers ~/memory (file + dir listing with no-trailing-slash fallback), ~/tools (listing +
    contracts), hm://, ipfs://, https://, activity:, attachment:, thread:, run:. write covers memory (content / delete /
    fromUrl / fromAttachment), ipfs:// (fromPath / fromAttachment), and hm:// (action: document | update | comment |
    move | redirect | delete | fork — synthesized envelopes into the existing signed command handlers; options.fromPath
    routes to the memory-markdown publishing pipeline).
  - `call` is contract-on-miss: unknown tool → callable listing; invalid input → the tool's contract plus structured
    validation errors, retry executes. This is the M2 touch-expand behavior, live early.
  - `delegate` merges the three spawn tools: default = awaited model child (verbatim `brief`, typed `output`), `script`
    = journaled QuickJS child, `await: false` = detached child. The parent transcript's tool_result name is `delegate`
    for all three.
  - The three name-filter chains are deleted; `enabledCallableTools()` is the single seam. `definition.tools` now
    narrows callable tools only; verbs are always on; unknown/legacy names are ignored.
  - System prompt: memory paragraph rewritten in verb vocabulary; `<tools>` index block lists enabled callables (one
    summary line each) — the seed of M2's Space index; hm-write instructions rewritten for address+options shape. The
    memory/exec/start_session paragraphs and set_session_title are gone (titling was already automatic).
- `agents/src/workflow-host.ts` — `ctx.delegate` added as the documented name; `ctx.agent` stays a synonym on the same
  journal op, so existing journals replay unchanged.
- `agents/e2e/run.ts` — gate scenarios rewritten to the verb vocabulary; `e2e/recordings/STALE.md` marks the gpt-5-mini
  cassettes invalid (fingerprints embed tool names); replay mode skips loudly with exit 0 until a live re-record.

## Measured

- Provider-facing tool surface: **28,886 bytes / 23 tools → 8,483 bytes / 5 verbs (−71%)**.

## How it was verified

- `bun x tsc --noEmit` green (agents package).
- New `src/verbs.test.ts`: 14 unit tests over the three dispatchers with hand-built mocks (temp memory dir, in-memory
  SQLite, spy callbacks, fake code executor, per-test fetch mocks satisfying the client zod schemas).
- Stable suites green: 146 tests (runs, workflow-host, verbs, code-exec, agent-memory, session-attachments, json-schema,
  web-tools, reasoning, activity/schedule triggers, auth, poll-loop, provider-oauth).
- api-service.test.ts / main.test.ts / sqlite.test.ts swept to the verb contract — full server suite **221 pass / 0
  fail** (8.6s, no hangs). The sweep exposed and fixed three real dispatcher gaps: (1) `read https://…` now tries the
  hypermedia resolver first (Seed site/gateway URLs) and falls back to the web reader; (2) dotted `options.action`
  values (`profile.update`, `draft.create`, `capability.create`, `contact.*`, …) pass through to the signed command
  handlers, keeping the old envelope's full reach; (3) memory-markdown publishing key fixed (`documentPath`) with `/`
  addresses deferring to frontmatter-derived paths.
- **Blind simulated-model gate: PASS.** A fresh model given only the verb surface handled all six scripted scenarios
  correctly: plan→parallel typed fan-out (three `delegate` calls with sound nested output schemas in one turn), no
  delegation for trivial arithmetic, a durable script child (with per-file `ctx.step` labels and batched `ctx.parallel`)
  for a 40-file loop, read-https → memory note → hm:// publish with title option, touch-expand (`read ~/tools/execute`)
  before calling, and restrained detached delegation (`await: false`) with safety constraints written into the brief.
  Its 49-item guessed-contract list drove a description-tightening pass: listing and file-read result shapes named in
  `read`; auto-created parents + whole-file replacement named in `write`; `ctx.call` reaching read/write verbs, per-call
  result correlation, and ctx.delegate's direct resolution shape named in `delegate`. Remaining guesses are M2 index
  concerns (roster completeness) and M4 (execute contract), noted there.
- Desktop sweep done (the delegated agent died silently; redone first-hand): tool config toggles only callables; sidebar
  assistant narrows to search-only; transcript rendering keys on `delegate` (accepting `sub_session` in old
  transcripts), `call`+execute reuses the code view, write's command-keyed custom views restored for old and new event
  shapes. Desktop unit suite **259 pass / 0 fail**; desktop typecheck clean except the pre-existing uncommitted
  `forge.config.ts` entitlements change (Eric's, untouched).
- **Adversarial review (high): 14 verified findings, all dispositioned.** Fixed: scripts had no path to callable tools
  (ctx.call now routes through the call-verb dispatch — the one CONFIRMED critical); `execute_code` alias restored for
  stored definitions; delegate's detached path validated loudly (script+await:false rejected; agentId/output/tools
  rejected; brief required and rendered verbatim); write's contract now names `action: "update"` and the default's
  new-document semantics; child tool narrowing intersects against the full callable set instead of a stale `['read']`
  base; trigger instructions rewritten from the dead command envelope to the write-verb reply shape; the deleted
  set*session_title instruction removed from the shared prompt (and the activity-feed line moved to `read activity:`);
  https reads fall back to the web reader only on hypermedia \_resolution* failure (real hypermedia errors surface);
  write option passthrough moved from a blacklist to explicit `options.input` (alias-collision hazard closed); thread
  transcript truncation marked. Accepted as-is: the per-turn memory-listing walk (cache follow-up noted for M2) and the
  hand-cleared STALE.md marker (deliberate, documented). Refuted by the reviewer's own verification: the
  navigate-via-call gap (touch-expand covers it).

## Known gaps / decisions to flag

- Old transcripts keep historical tool names; renderers fall back to generic rendering (no data migration — history is
  history).
- Live cassette re-record deferred until credits (STALE.md documents the exact procedure).
- Stored agent definitions with old `tools` arrays: `execute_code` maps to `execute`; names absorbed into verbs are
  inert (the capabilities they gated are now always-on verbs). Flagged for Eric: acceptable, or also migrate rows?
- The memory-listing prompt walk runs per turn (pre-existing); M2's index work caches it behind onMemoryChange.

## Eric's five-minute test

1. Start the agents server + desktop; open an agent chat.
2. Ask it to save a note in memory, then read it back — expect `write ~/memory/…` and `read ~/memory/…` tool rows.
3. Ask for a web search — expect a `call {tool: web_search}` row rendered with the query.
4. Ask it to delegate two research tasks in parallel and combine results — expect one checklist, two child rows under
   it, park + resume, and a final combined answer.
5. Ask for something trivial — expect no delegation, no plan.
