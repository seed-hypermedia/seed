---
name: Model Comms Latency
summary: How to make every provider round-trip cheaper and the first token arrive sooner. Companion to agent-speed-plan.md; the egress-volume view of the same…
---
How to make every provider round-trip cheaper and the first token arrive sooner. Companion to [agent-speed-plan.md](./agent-speed-plan.md); the egress-volume view of the same problem is workstream 4 of [perf-squeeze-plan.md](./agent-perf-squeeze-plan.md). <!-- id:5YS5DZIm -->

# What we now measure <!-- id:t2RVPlFb -->

Per provider request (this branch): `provider.request_gap` (turn dispatched → request sent), `provider.ttft` (request sent → first streamed event, also logged per request), `provider.turn` (request → turn complete). Collect a week of `/api/perf` from prod before and after each lever below — TTFT p50/p95 is the success metric. <!-- id:9njfBnGs -->

# Levers, best first <!-- id:0XHvpL-W -->

## 1. Prompt caching (Anthropic-style) <!-- id:cKICp29g -->

The Anthropic API caches prompt prefixes (`cache_control` breakpoints); a cache hit prices cached input at \~10% and — the part that matters here — **cuts time-to-first-token substantially** because the provider skips re-prefilling the transcript. Our sessions are the ideal shape: a stable system prompt + tool contracts + an append-only transcript. <!-- id:7o0KA0Tv -->
  - Verify what the Pi SDK already does per provider: whether it sets cache breakpoints for Anthropic, and whether usage's `cacheRead` (already recorded in `RunUsage`) shows hits in prod. If `cacheRead` is \~0 on Anthropic providers, this is free money sitting on the table. <!-- id:INLTGQbh -->
  - Breakpoint placement: end of system prompt, end of tool definitions, and a moving breakpoint at the last-but-one turn. Keep the prefix **byte-stable** — see lever 4. <!-- id:Q4BNyxTt -->

## 2. Server-side conversation state (openai-codex) <!-- id:ZZjOsVoG -->

The Responses API supports `store: true` + `previous_response_id`: send only the new turn, the provider keeps the context. Collapses per-turn upload from O(session) to O(delta) — the biggest single win for the fat dev sessions that produced 91 GB of egress in 33h. Needs Pi SDK support verification; fall back to full replay where unsupported. <!-- id:osSJ_Axn -->

## 3. Context compaction <!-- id:A0L4Cbas -->

Old tool results are the dead weight: 64 KB exec outputs that stopped mattering three turns ago are re-serialized, re-uploaded, and re-prefilled every turn (and on cache misses they blow the prefix). Elide or summarize tool results older than N turns, leaving a model-visible `[output elided]` note. This cuts bytes, event-loop serialization time, AND makes prompt-cache prefixes shorter to rebuild on a miss. The append-time spill of oversized outputs (perf-squeeze §6 follow-up) is the storage-side twin of this. <!-- id:LHGoHg_P -->

## 4. Byte-stable prefixes <!-- id:0Y96YhUF -->

Prompt caching only pays when the prefix is identical across turns. Current hazards to audit: <!-- id:B7olBWqX -->
  - The plan-state block and `<background_work_update>` / `<concurrent_user_messages>` synthetics are appended with `timestamp: Date.now()` — if timestamps serialize into the payload, every turn busts the cache. Pin or strip them. <!-- id:OAE1cKTo -->
  - System-prompt resolution embeds remote hm:// docs (cached 5 min) — a re-fetch that changes bytes mid-session busts the whole cache. Consider pinning the resolved prompt for the session's lifetime instead. <!-- id:b8OqIR7C -->
  - Tool promotion (touch-expand) changes the tool list mid-session; unavoidable when it happens, but tool definitions should sit in their own cache segment so a promotion only invalidates from there. <!-- id:CXDfSExd -->

## 5. Leaner turn prep <!-- id:pKySxDLe -->

`provider.request_gap` measures everything before the request leaves. Known costs in that window: `#piMessages` decoding the full CBOR transcript every turn (grows with session length; the wire-truncation work capped what's _stored_, not what's _replayed_), building replay messages, and Pi session assembly. If prod shows this gap growing with session length, an in-memory decoded-transcript cache per live session is the fix. <!-- id:hfR4vki4 -->

## 6. Fewer round-trips per task <!-- id:E8oP4Cft -->

Each tool batch costs a full provider round-trip on a growing context. Two behavioral levers, no protocol work: <!-- id:lWqSvrjI -->
  - Tool prompts should keep pushing agents to batch independent tool calls in one turn (parallel calls in one response) rather than one-per-turn. <!-- id:0l-rftJt -->
  - Long tool outputs the model only needs a slice of (big file reads, listings) should come back pre-bounded — the smaller each result, the cheaper every subsequent turn. Mostly done via output caps; audit stragglers. <!-- id:s4_Wv9Xy -->

# Suggested order <!-- id:DdAzOGdy -->

1. Measure: deploy instrumentation, read a week of `provider.ttft` / `provider.turn` / `cacheRead` per provider. <!-- id:MoOe4URK -->
2. Prompt caching verification + byte-stable prefix fixes (levers 1+4) — likely the best TTFT/$ ratio. <!-- id:Vq77V6Jl -->
3. `previous_response_id` for codex (lever 2) — biggest upload/serialization win. <!-- id:IiB-q5gk -->
4. Compaction (lever 3), then turn-prep caching (lever 5) if `request_gap` says so. <!-- id:TBolxmAu -->
