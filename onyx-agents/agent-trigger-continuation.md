---
name: "Agent trigger continuation"
summary: "What a trigger firing does: new thread, wake a run, or a headless tool/script."
---

Four variants: `newThread` (start a fresh thread from the trigger's prompt — the default), `wake` (deliver a signal to a run parked on an awaited event), `tool` (call one tool headlessly, no model involved), and `script` (run a workflow script headlessly). Headless variants declare `onFailure`: record the error, or escalate into a thread a model can investigate.
