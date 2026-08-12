# Checkmark review — M4-UX: elegant orchestration UI (`harness/04-orchestration-ux`)

Status: **draft — adversarial review in flight.** Eric's feedback package, implemented verbatim.

## What changed

- **Scripts narrate their work**: `ctx.call(tool, input, {description})` — journaled as display
  metadata outside the replay key (relabeling never breaks resume), streamed as live activity,
  contract updated to require it.
- **`run-work.tsx`** (new): one module renders "the work" everywhere — journal call/result pairs
  become ChatToolParts labeled by description, and `RunWorkHierarchy` shows the integrated
  step/child list with tool calls in the chat's own ToolRow UI (injected renderer, no dup visual
  language).
- **Expanded delegate rows** lead with the child's hierarchy, described calls, typed result, and
  an "Open transcript →" link; script source and raw payloads live behind ⓘ (which gained a
  readable Script section).
- **Run card** (pinned live + finished record) renders the same hierarchy; Activity/Code drawers
  remain the technical drill-down. ~200 lines of duplicated card logic deleted.
- **The checklist is one list**: a step with a child IS the interactive row — status dot, live
  activity, click into the sub-session, hover-× cancel; the separate sub-session rows beneath the
  todos are gone. (Completes the v1 "step and child are one row" decision.)

## Verified

- Agents **231/0**, desktop **278/0** (4 new tests: journal→parts mapping with description
  labels, step-row = sub-session link with no duplicate child row, hover-× cancel, expanded
  delegate shows hierarchy not source). Typechecks clean (forge.config excepted).
- [pending] adversarial review disposition.

## Eric's two-minute test

1. Ask for a parallel research task — the pinned card's checklist rows ARE the children: click
   the running step, land in the researcher's transcript.
2. Expand the Delegate bubble — expect the work story (steps, "narrated" tool calls in normal
   tool-row style), not code; ⓘ for the script.
3. After it finishes, find the same card in the transcript — same view, frozen; Activity drawer
   still has the raw journal.
