---
name: Resource
summary: "The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by "
schemaDefinition: ipfs://bafyreicdh6ygouxie6xlnfdikbtd6xz465aem3fz7h3oh54cw2t4yyopf4
---
The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:DKrlmk-b -->

This document describes the **seed-resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:8qMDyX3F -->

# Shape <!-- id:QnWTk-_C -->

A **union** — a value matches one of these variants: <!-- id:jNUpA86w -->
  - [seed-resource-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-document) <!-- id:_NMQg8CE -->
  - [seed-resource-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-comment) <!-- id:7TyvB5RT -->
  - [seed-resource-redirect](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-redirect) <!-- id:Qk2kHMNK -->
  - [seed-resource-not-found](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-not-found) <!-- id:puViM4jF -->
  - [seed-resource-tombstone](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-tombstone) <!-- id:4g2ZdiEu -->
  - [seed-resource-error](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-error) <!-- id:zAIVwKIe -->

# Depends on <!-- id:N8NdNOBK -->

- [seed-resource-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-comment) <!-- id:H4xXgtvX -->
- [seed-resource-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-document) <!-- id:TXHngH-I -->
- [seed-resource-error](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-error) <!-- id:UEIBXH0y -->
- [seed-resource-not-found](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-not-found) <!-- id:fm6kS7fS -->
- [seed-resource-redirect](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-redirect) <!-- id:g4RUXR0d -->
- [seed-resource-tombstone](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-tombstone) <!-- id:30MZAJAa -->
