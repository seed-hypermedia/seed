---
name: Obligations
summary: An obligation is something a turn still owes when it ends, such as an undelivered typed result or an unfinished plan step, and the runtime hands the turn back until it is met or reported.
---
An **obligation** is something a turn still owes when it tries to end. There are two kinds: a [typed result](./typed-result.md) the run has not delivered, and [plan](./plan.md) [steps](./step.md) it has neither finished nor written off. For example, an [agent](../agent.md) that published three steps and stops after two still owes the third.

The runtime does not let such a turn end quietly. It hands the turn back to the model with the list of what is owed, up to three times, and records what is left. Nothing is ticked off on the agent's behalf.

# Handing the turn back

When a turn ends, `#openObligations()` (`api-service.ts`) collects one list: an undelivered typed result, and unfinished plan steps. If the list is not empty, the run hands the turn back and names every open obligation at once. It does this up to `MAX_RUN_CONTINUATIONS` (3) times per run (`#executeAgentRun`). A run that parks and resumes starts that count again. <!-- id:ou9pyPWe -->

# What counts, and how a run ends

- A step left open while children are still working on it is not an obligation. Someone else is carrying it. <!-- id:U08n9EAn -->
- `failed` and `skipped` are final. An agent that says it could not do something has done its duty. The runtime never pushes it to pretend.
- After three hand-backs, the run leaves a `system` notice that says exactly what was left undone.
- A typed child that never delivered its result **fails**.
- A run with an unfinished plan **succeeds, and still owes the steps**.

A [run](./runs.md) that ends owing something carries the list as `unmetObligations` on its record.

# See also

- [Plan](./plan.md)
- [Step](./step.md)
- [Typed result](./typed-result.md)
- [Runs](./runs.md)
- [Security](./security.md)
