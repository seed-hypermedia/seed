---
name: "Collaborators payload"
summary: "A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model comp"
---

# Collaborators payload

A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-collaborators-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `publisherUid` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `parentCapabilities` *(required)* — list of [seed-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-capability)
- `grantedCapabilities` *(required)* — list of [seed-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-capability)
- `grantedMembers` *(required)* — list of [seed-site-member](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-site-member)
- `members` *(required)* — list of [seed-site-member](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-site-member)
- `accounts` *(required)* — [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata)

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata)
- [seed-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-capability)
- [seed-site-member](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-site-member)
