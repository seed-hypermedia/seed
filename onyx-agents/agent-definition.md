---
name: "Agent definition"
summary: "The content-addressed configuration blob an agent document points at."
---

The configuration of an agent as one content-addressed DAG-CBOR blob: name, system prompt (plain text or a rich [block tree](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-prompt-block)), model choice and quick-switch [model refs](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-model-ref), enabled tools and MCP servers, and the signing identities the agent may publish as.

Two deliberate boundaries:

- **Signing identities are principals, never server-local key names.** Which identity signs a given record — the agent's, or the server's own — is a per-record-type choice made deliberately.
- **Server-private material is absent.** API keys, OAuth sessions, and raw signing keys stay on the agent server; the network never sees them.

The blob is unsigned; its authority comes from the signed [agent-document](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-document) that references it by CID.

## Depends on

- [agent-model-ref](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-model-ref)
- [agent-prompt-block](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-prompt-block)
- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal)
