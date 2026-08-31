---
name: "Agent session document"
summary: "The document that anchors one session; its messages are ordinary Comments."
---

A session (thread) with an agent is anchored by a document, and **the conversation itself is ordinary Hypermedia Comments** — see [agent-message](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-message) — targeting this document. That makes the whole transcript permanent, signed, threaded network data that any peer can fetch, verify, and index exactly like a discussion.

- `agent` points at the [agent-document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-document) this session converses with.
- A **sub-session** is another session document whose `parentSession` points here.
- Ephemeral state (streaming output, in-flight tool calls) never reaches the network; derived state such as a status flag is computed by readers, not stored.

## Shape

**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document); metadata requires:

- `agent` — [hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url), target [agent-document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-document)
- optional `parentSession` — [hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url), target [agent-session-document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-session-document)
