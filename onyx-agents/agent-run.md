---
name: "Agent run"
summary: "The durable record of one unit of agent work: a model turn, a headless call, or a script."
---

A run is the **execution record**, conceptually distinct from the conversation ([agent-message](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-message)) and from tool activity ([agent-tool-call](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-call) / [result](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-result)): status, lineage (`parentRunId`, owning [session](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-session-document)), pinned `sourceCid` (the exact script a resumed workflow replays against), input and output, its [plan](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run-plan), and cumulative [usage](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run-usage). Runs and plans are part of the session but are not chat.
