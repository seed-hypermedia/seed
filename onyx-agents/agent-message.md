---
name: "Agent message"
summary: "One session message as a full, normal Hypermedia Comment, plus agent metadata."
---

The central decision of this model: **a session message is a full, normal Comment** — not a private server log row. It extends [hypermedia-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-comment), so it targets the [session document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-session-document), threads via `threadRoot`/`replyParent`, and replicates like every other signed blob.

- A **user message** is signed by the user's account, or by a delegated device key carrying a capability — the mechanism comments already support.
- An **agent message** is signed by one of the agent's [signing identities](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-definition).
- The body may contain [agent-tool-call-block](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-call-block) and [agent-tool-result-block](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-result-block) nodes, so one threaded transcript carries the mixed chain of prose and tool activity.

Augmented fields: `actor` (user | agent | trigger | system), `agent` (for indexing messages across sessions), `runId` (the run that produced an agent message), and `clientMessageId` (optimistic-send reconciliation).

This replaces the server-private MessageSession log entry as the canonical record of what was said.
