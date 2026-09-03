---
name: "Checkmark review — M4-UX: elegant orchestration UI (harness/04-orchestration-ux)"
summary: "Status: draft — adversarial review in flight. Eric's feedback package, implemented verbatim."
---
Status: **draft — adversarial review in flight.** Eric's feedback package, implemented verbatim.

## What changed

- **Scripts narrate their work**: `ctx.call(tool, input, {description})` — journaled as display metadata outside the
  replay key (relabeling never breaks resume), streamed as live activity, contract updated to require it.
- **`run-work.tsx`** (new): one module renders "the work" everywhere — journal call/result pairs become ChatToolParts
  labeled by description, and `RunWorkHierarchy` shows the integrated step/child list with tool calls in the chat's own
  ToolRow UI (injected renderer, no dup visual language).
- **Expanded delegate rows** lead with the child's hierarchy, described calls, typed result, and an "Open transcript →"
  link; script source and raw payloads live behind ⓘ (which gained a readable Script section).
- **Run card** (pinned live + finished record) renders the same hierarchy; Activity/Code drawers remain the technical
  drill-down. ~200 lines of duplicated card logic deleted.
- **The checklist is one list**: a step with a child IS the interactive row — status dot, live activity, click into the
  sub-session, hover-× cancel; the separate sub-session rows beneath the todos are gone. (Completes the v1 "step and
  child are one row" decision.)

## Verified

- Agents **231/0**, desktop **278/0** (4 new tests: journal→parts mapping with description labels, step-row =
  sub-session link with no duplicate child row, hover-× cancel, expanded delegate shows hierarchy not source).
  Typechecks clean (forge.config excepted).
- [pending] adversarial review disposition.

### Since this review (2026-08-13)

- **The pending disposition was never recorded.** No adversarial-review findings for this milestone were written into
  this doc or any other; the next commit after the UI work added narration test coverage and the live-gate harness
  (`e2e/live-gate.ts`, `e2e/narration-check.ts`), and the work moved on to M4-exec. Treat the disposition line above as
  unresolved, not as a pass.
- **The checklist gained two behaviors.** A step whose attached sub-agents all came back succeeded is now closed by the
  runtime and stamped `resolvedBy: 'runtime'` (only success is ever derived that way), and a plan that has gone fully
  terminal records `RunPlan.settledAt` — the moment the card leaves the pinned slot and freezes into the log.
- **Multi-child steps render as uniform peers** under an inert header; a step with exactly one child keeps the
  integrated row this review describes. Step labels also stopped truncating until the space actually runs out.
- Still true: `run-work.tsx` is the one renderer of "the work", `ctx.call`'s `{description}` stays outside the replay
  key, and `RunWorkHierarchy` is shared by the pinned card, the finished record, and the expanded delegate bubble.

## Eric's two-minute test

1. Ask for a parallel research task — the pinned card's checklist rows ARE the children: click the running step, land in
   the researcher's transcript.
2. Expand the Delegate bubble — expect the work story (steps, "narrated" tool calls in normal tool-row style), not code;
   ⓘ for the script.
3. After it finishes, find the same card in the transcript — same view, frozen; Activity drawer still has the raw
   journal.
