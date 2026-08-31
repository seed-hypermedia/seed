---
name: "Agent document"
summary: "An agent as a Hypermedia resource: a typed document that IS the agent on the network."
---

An agent is an ordinary resource: a typed document in a space. Its metadata carries `agentDefinition` — an `ipfs://` reference to the [agent-definition](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-definition) configuration blob, the same binding pattern `schemaDefinition` uses for schemas — and its content is the agent's public description. Whoever can edit the document configures the agent; an agent server *executes* what the document describes.

Permissions are deliberately not modeled here. An agent document sits in the resource tree and inherits the hierarchical permission rules of the Resource system (owner, collaborators, public read/chat all become ordinary grants on the resource).

## Shape

**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document); metadata requires:

- `agentDefinition` — [ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) reference, target [agent-definition](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-definition)

## Depends on

- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document)
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata)
- [agent-definition](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-definition)
