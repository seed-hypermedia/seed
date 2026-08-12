# Overnight plan (2:15am → 9am) — make the harness beautiful

Standing orders: NO GitHub pushes. Commit locally per package. Use opus general-purpose agents for
heavy work (token economy); forks only when full context is essential. Every package: gates
(agents bun test --timeout 15000, desktop vitest, tsc) → /code-review high on the worktree →
disposition → story commits → append pre-verified test cases to ~/Code/Seed/HARNESS-TESTING.html
→ build-log update (seed-cli, key 'main', hm://z6MkmZUb…/harness/build-log). Keep ≥1 agent in
flight at all times; agent completions are the heartbeat.

Branch: harness/04-orchestration-ux in ~/Code/Seed-worktrees/harness-03 (UX package built, review
findings pending disposition). Eric tests M1 in ~/Code/Seed on :3051 (bun --hot, subscription
OpenAI provider — usable for LIVE gates; sign via the desktop daemon gRPC :56002 pattern from
agents-client createDaemonSigner, account uid from his server's accounts table).

Queue (in order):
1. UX-review disposition (findings arriving) + Eric's glanceability package: address-aware
   clickable tool summaries (hm title / ~/memory path / web host / attachment; chips for source
   kind), everything in summaries+expansions clickable (hm→navigate, memory→Memory tab,
   child→transcript), minimal-satisfying polish pass over pinned card + rows. [opus agent NOW]
2. Live gate on :3051: drive real runs (delegate fan-out w/ narrated ctx.call, memory round-trip,
   publish dry-run) via daemon-signed envelopes; record outcomes; then append cases to
   HARNESS-TESTING.html (cumulative: M1 guide + M2 + M3 + UX + live results, each with exact
   prompt + expected outcome).
3. M4 exec: execute {runtime: 'ts'|'python'|'shell', code} (TS via Bun runner image; keep shell),
   callable lambda tool documents (call → execute stored source, Onyx/JSON validated both edges),
   minimal exec config. Branch harness/05-exec stacked.
4. M5 time: ctx.waitForEvent as ephemeral trigger + budget-pause wait + continueAsNew + parked
   copy. 5. M6 event bus if night allows.
6. 8:30am: final polish, full-stack gates, build-log morning entry, morning summary for Eric
   (what shipped, what to test, decisions queued).

## Findings queue (from live gate, 00:5x)
- F1 SERIAL-PARALLEL (real, reproduced in Eric's session cbc80ba5): gpt-5.6-sol never emits two
  delegate calls in one reply; serial park/resume chains, sometimes duplicate re-spawns. Fix in
  agents/protocol tool-registry delegate description AFTER glance's disposition lands (same file):
  add "when work parallelizes, emit ALL delegate calls in ONE reply — never await one child before
  spawning the next; never re-spawn a child whose result you already hold" + a two-call example;
  ALSO steer: "for fan-out over more than ~2 items, prefer a script child with ctx.parallel".
  Re-run live-gate fan-out scenario after to measure.
- F2 ctx.call narration untested in agents/src: port e2e/narration-check.ts case into
  src/workflow-host.test.ts (assert journal 'call' entry carries description + activity detail).
- Testing doc HARNESS-TESTING.html exists at main checkout root — every future package APPENDS
  cases there (exact prompt + expected outcome + verification marker). Live gate re-runnable:
  agents/e2e/live-gate.ts --base http://localhost:3051 (daemon gRPC :56001 signData signing).
- F3 (from UX disposition): server-side child link runs.parent_tool_call_id + RunInfo surface so delegate bubbles can resolve live model children; then restore live-child hierarchy in DelegateRunView. Do in M4.
- F4 (from F1 final gate): attachment joins on MUTABLE label — models rename steps, stamps go stale (2/3 runs detached). Fix: stamp planStepId at spawn + RunInfo.planStepId + run-work.tsx childrenByStep keyed by id w/ label fallback. Assigned live-gate.
- F5 resilience: upstream 503 (Codex server_is_overloaded) kills the whole parent turn, no retry despite retryable classification — attempt budget for provider-errors, queue with M5.
- F6 BACKGROUND PUMP ORPHANED BY `bun --hot` RELOAD (dev-only, hit :3051 at ~01:2x): child runs
  enqueue and never leave `queued` while interactive turns keep working, so it silently reads as
  "the agent is thinking" — a delegation demo just hangs. Reproduced twice ten minutes apart;
  killing the inner `bun --hot src/main.ts` (the watch-file-deps supervisor respawns it) restored
  draining immediately, and `script-parallel` passed in 25.3s straight after. Fix: re-arm the
  dispatch loop on hot reload, or at minimum expose queue depth + last-drain timestamp on
  /agents/api/health so the stall is visible instead of looking like slow thinking.
