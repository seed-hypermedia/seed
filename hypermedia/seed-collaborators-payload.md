---
name: Collaborators payload
summary: "A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model comp"
schemaDefinition: ipfs://bafyreiejja7z7r3reqp4cdr4epq74qpsfdzomqti34mi5ufqoh5x5t3q7e
---
A document's collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:qppfw6ji -->

This document describes the **seed-collaborators-payload** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:o_ipNuGi -->

# Shape <!-- id:0pHZWhFV -->

A **closed struct** with these fields: <!-- id:aPWcE-eZ -->
  - `publisherUid` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:dNxcOhZ0 -->
  - `parentCapabilities` _(required)_ — list of [seed-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-capability) <!-- id:1Qe1cDdo -->
  - `grantedCapabilities` _(required)_ — list of [seed-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-capability) <!-- id:F1LujJDo -->
  - `grantedMembers` _(required)_ — list of [seed-site-member](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-site-member) <!-- id:MgzEcRK6 -->
  - `members` _(required)_ — list of [seed-site-member](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-site-member) <!-- id:0jqsG9an -->
  - `accounts` _(required)_ — [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata) <!-- id:iTCASGut -->

# Depends on <!-- id:EuNEDEuM -->

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:wh5e0WNl -->
- [seed-accounts-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-accounts-metadata) <!-- id:VDls_Pgs -->
- [seed-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-capability) <!-- id:DNmDsWAi -->
- [seed-site-member](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-site-member) <!-- id:0RjtWQQY -->
