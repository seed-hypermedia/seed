---
name: "Agent action"
summary: "The signed control-plane envelope, normalized to a literal Hypermedia signed blob."
---

Every configuration action a client sends to an agent server — create or update an agent, set a trigger, write memory, invoke a tool — travels as one signed envelope. This schema normalizes it to be a **literal Hypermedia signed blob**: it extends [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob), so `ts` sits at the envelope root. That is the one breaking change from the current wire shape, adopted as part of the single cohesive data-model change: a signed action then verifies, hashes, and publishes exactly like a Change or a Comment — the received bytes are archivable, content-addressed permanent data.

- `account` is the principal the action is for; when it differs from `signer`, `capability` names the Capability blob delegating account to signer, so any third party can verify an archived envelope with no server involvement.
- `action` is the payload, discriminated by its `_` name.

With [sessions-as-comments](hm://z6Mkqi6bocisxxWzmXSXErC9WpcoonHnpkcogWoSTgoSQTtJ/agent-message), chat no longer flows through this envelope; what remains is configuration and tool invocation.

## Depends on

- [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob)
- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal)
- [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid)
