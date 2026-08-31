---
name: "Agent run plan step"
summary: "One step of a run plan."
---

An id, a label, and a status (`pending`, `running`, `done`, `failed`, `skipped`). `resolvedBy: runtime` marks a step the runtime closed as a matter of record — every attached sub-agent succeeded — rather than the model or the user.
