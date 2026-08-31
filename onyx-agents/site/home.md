---
name: "Agents on Permanent Data"
summary: "Proposed Onyx schemas for the agent data model: agents, sessions, messages, tools, triggers, and runs as signed, content-addressed network data."
---

This site is the proposed data model for moving agent state from server-owned rows to **permanent, signed, independently verifiable network data** — written as [Onyx](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb) schemas, so every type is simultaneously human-readable documentation and a machine-checkable (always advisory) structure. It responds to the team note on agents and permanent data and the research notes that followed it.

## The model in one paragraph

An **[agent is a resource](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-document)**: a typed document whose metadata binds a content-addressed **[definition](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-definition)**. A **[session](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-session-document)** is a document, and the conversation is **[ordinary Comments](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-message)** — user messages signed by the user (directly or through a delegated device key), agent messages signed by the agent's own identity, tool activity carried as [call](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-call-block)/[result](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-result-block) blocks linking [content-addressed records](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-call). **[Runs](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run)** and **[plans](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run-plan)** are execution records, distinct from chat. The remaining control plane — configuration, [triggers](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-trigger), [tools](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-document) — travels as **[signed action envelopes](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-action)** normalized to literal Hypermedia blobs, so the received bytes archive as permanent data.

## Decisions this model encodes

- **Sessions are comments.** Real Comment blobs replace the private MessageSession log as the canonical transcript; p2p collaboration over agents falls out of the existing network.
- **Strategic signing, no countersigning.** The agent signs as its configured identities; the server signs infrastructure records as its own; trusting the server is enough — no hash-chain countersigning ceremony.
- **Permissions come from the Resource system.** Agents are resources in the single-parent resource tree; hierarchical grants replace bespoke owner/collaborator/public flags.
- **Tombstones, not true deletion.** Appending tombstones into the content-addressed store is the deletion model; a configurable garbage collector can come later.
- **One swift breaking change.** The envelope becomes a literal signed blob (root `ts`), legacy content converts wholesale.
- **Server-private stays private.** API keys, auth sessions, raw signing keys, and ephemeral streaming state never reach the network.

## Types

**Identity and configuration** — [agent-document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-document) · [agent-definition](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-definition) · [agent-model-ref](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-model-ref) · [agent-prompt-block](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-prompt-block)

**Conversation** — [agent-session-document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-session-document) · [agent-message](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-message) · [agent-tool-call-block](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-call-block) · [agent-tool-result-block](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-result-block)

**Tool activity** — [agent-tool-call](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-call) · [agent-tool-result](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-result) · [agent-tool-document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-tool-document)

**Automation** — [agent-trigger](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-trigger) · [agent-trigger-source](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-trigger-source) · [agent-schedule](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-schedule) · [agent-trigger-continuation](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-trigger-continuation)

**Execution** — [agent-run](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run) · [agent-run-plan](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run-plan) · [agent-run-plan-step](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run-plan-step) · [agent-run-usage](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-run-usage)

All base types come from the [Onyx schema library](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb). Everything here is a proposal: schemas are notation for the design conversation, not an enforcement mechanism.
