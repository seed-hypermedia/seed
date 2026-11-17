---
name: Obligations
summary: An obligation is what a turn still owes when it ends, an undelivered typed result or unfinished plan steps, and the runtime hands the turn back until it is met or reported.
---
An **obligation** is something a turn still owes when it tries to end: a [typed result](./typed-result.md) it has not delivered, or [plan](./plan.md) [steps](./step.md) it has neither finished nor written off. The runtime hands the turn back to the model with the list, a bounded number of times, and records what is left. Nothing is ticked off on the agent's behalf.

# The continuation loop

A turn that ends still owing something does not just end. `#openObligations()` (`api-service.ts`) collects one list: an undelivered typed result, and unfinished plan steps. The run hands the turn back with every open obligation named at once, up to `MAX_RUN_CONTINUATIONS` (3) times per run (`#executeAgentRun`); a run that parks and resumes starts that count again. <!-- id:ou9pyPWe -->

# What counts, and how a run ends

Steps left open while children are still working are not obligations, because someone else is carrying them. `failed` and `skipped` are terminal. An agent that says it could not do something has kept the contract, and the runtime never nags it into pretending otherwise. When the budget is spent, the run leaves an actor-`system` notice that says exactly what was left undone. A typed child that never delivered **fails**. An unfinished plan **succeeds owing it**. Nothing is ever ticked off on the agent's behalf. <!-- id:U08n9EAn -->

A [run](./runs.md) that ends owing something carries the list as `unmetObligations` on its record.

# See also

- [Plan](./plan.md)
- [Step](./step.md)
- [Typed result](./typed-result.md)
- [Runs](./runs.md)
- [Security](./security.md)
