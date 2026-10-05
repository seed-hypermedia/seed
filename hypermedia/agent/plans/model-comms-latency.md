---
name: Model Comms Latency
summary: A plan to make each model-provider round trip cheaper and the first streamed token arrive sooner, through prompt caching, byte-stable prompt prefixes, leaner turn preparation, and fewer round trips.
---
How to make every [model provider](../model-providers.md) round trip cheaper and the first token arrive sooner. This goes with the [speed plan](./speed.md). Workstream 4 of the finished perf-squeeze plan covered the egress-volume side of the same problem. That plan now lives only in git history. <!-- id:5YS5DZIm -->

# What we measure now <!-- id:t2RVPlFb -->

Per provider request (this branch): <!-- id:mF9Nt8Pv -->
  - `provider.request_gap`: from turn dispatch to request sent. <!-- id:drBinaym -->
  - `provider.ttft`: from request sent to the first streamed event, also logged per request. <!-- id:CAPipt8e -->
  - `provider.turn`: from request to turn complete. <!-- id:HjqGccIT -->

Collect a week of `/api/perf` from prod before and after each lever below. TTFT (time to first token) p50 and p95 is the success metric. <!-- id:9njfBnGs -->

# Levers, best first <!-- id:0XHvpL-W -->

## 1. Prompt caching (Anthropic-style) <!-- id:cKICp29g -->

The Anthropic API caches prompt prefixes (`cache_control` breakpoints). A cache hit prices cached input at about 10%. More important here, it **cuts time to first token a lot**, because the provider skips re-prefilling the transcript. Our sessions fit this well: a stable system prompt, then tool [contracts](../contract.md), then an append-only transcript. <!-- id:7o0KA0Tv -->
  - pi-ai 1.0 asks for short cache retention by default: it sets cache breakpoints for Anthropic and sends each durable conversation's session id as the cache key where a provider routes by one. What is left is to check whether usage's `cacheRead` (already recorded in `RunUsage`) shows hits in prod, and whether long retention pays for itself. <!-- id:INLTGQbh -->
  - Breakpoint placement: end of system prompt, end of tool definitions, and a moving breakpoint at the second-to-last turn. Keep the prefix **byte-stable** (see lever 4). <!-- id:Q4BNyxTt -->

## 2. Server-side conversation state (openai-codex) <!-- id:ZZjOsVoG -->

The Responses API supports `store: true` + `previous_response_id`. The client sends only the new turn and the provider keeps the context. Per-turn upload drops from O(session) to O(delta). That is the biggest single win for the large dev sessions that produced 91 GB of egress in 33h. Pi SDK support still needs checking. Fall back to full replay where it is not supported. <!-- id:osSJ_Axn -->

## 3. Context compaction <!-- id:A0L4Cbas -->

Old tool results are the dead weight. A 64 KB exec output that stopped mattering three turns ago is re-serialized, re-uploaded, and re-prefilled every turn, and on a cache miss it breaks the prefix. Elide or summarize tool results older than N turns, and leave a model-visible `[output elided]` note. This cuts bytes and event-loop serialization time. It also makes prompt-cache prefixes shorter to rebuild after a miss. The append-time spill of oversized outputs (a follow-up from the finished perf-squeeze plan) does the same job on the storage side. [Session continuation](../session-continuation.md) is a separate approach that starts a fresh session. <!-- id:LHGoHg_P -->

## 4. Byte-stable prefixes <!-- id:0Y96YhUF -->

Prompt caching only pays when the prefix is identical across turns. Since the move to [durable sessions](../durable-sessions.md) the worst hazards are gone: the system prompt no longer carries the clock, the transcript is a list of stored entries that never change, and the per-turn state blocks (plan, context usage, session status, time) ride behind each turn's input without being stored. Hazards that remain: <!-- id:B7olBWqX -->
  - A delegated child's result is an edit of its placeholder entry, so a park-resume keeps the cache up to that entry and loses it from there on. A turn that rebuilds its whole context from the log (a restart repair, a session without a store) starts with a cold cache. <!-- id:OAE1cKTo -->
  - System-prompt resolution embeds remote [hm://](../../protocol/urls.md) docs (cached 5 min). A re-fetch that changes bytes mid-session breaks the whole cache. Consider pinning the resolved prompt for the session's lifetime. <!-- id:b8OqIR7C -->
  - Tool [promotion](../promotion.md) (touch-expand) changes the tool list mid-session. That can't be avoided when it happens. Tool definitions should sit in their own cache segment, so a promotion only invalidates from that point on. <!-- id:CXDfSExd -->

## 5. Leaner turn prep <!-- id:pKySxDLe -->

`provider.request_gap` measures everything before the request leaves. Known costs in that window: opening the session's [durable store](../durable-sessions.md), which reads its `main.jsonl`, and importing what reached the log since the last turn. A turn that has to rebuild its context (a restart repair, a session without a store) also pays `#piMessages` decoding the full CBOR transcript. Both grow with session length. If prod shows this gap growing, the fix is keeping a store open between the turns of a busy session. <!-- id:hfR4vki4 -->

## 6. Fewer round trips per task <!-- id:E8oP4Cft -->

Each tool batch costs a full provider round trip on a growing context. Two behavioural levers need no protocol work: <!-- id:lWqSvrjI -->
  - Tool prompts should keep pushing agents to batch independent tool calls in one turn (parallel calls in one response), instead of one call per turn. <!-- id:0l-rftJt -->
  - Long tool outputs where the model only needs a slice (big file reads, listings) should come back already bounded. The smaller each result, the cheaper every later turn. Output caps mostly do this already. Audit the stragglers. <!-- id:s4_Wv9Xy -->

# Suggested order <!-- id:DdAzOGdy -->

1. Measure: deploy instrumentation, then read a week of `provider.ttft` / `provider.turn` / `cacheRead` per provider. <!-- id:MoOe4URK -->
2. Verify prompt caching and fix byte-stable prefixes (levers 1 and 4). This likely gives the best TTFT per dollar. <!-- id:Vq77V6Jl -->
3. `previous_response_id` for codex (lever 2). This is the biggest upload and serialization win. <!-- id:IiB-q5gk -->
4. Compaction (lever 3), then turn-prep caching (lever 5) if `request_gap` calls for it. <!-- id:TBolxmAu -->

# See also <!-- id:Rh7OkGlh -->

- [Agent speed plan](./speed.md), the parent plan. <!-- id:SVphWtxp -->
- [Model providers](../model-providers.md), for provider records and request building. <!-- id:hYTrkMKd -->
- [Tools](../tools.md), for touch-expand and promotion. <!-- id:nKHXSncf -->
- [Prompt injection map](../prompt-injection-map.md), for what goes into each prompt. <!-- id:GjJXA0zG -->
- [Session continuation](../session-continuation.md), for moving a long conversation into a fresh session. <!-- id:SD1mImhf -->
