---
name: "Resource"
summary: "The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by "
---

# Resource

The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **union** — a value matches one of these variants:

- [seed-resource-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-document)
- [seed-resource-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-comment)
- [seed-resource-redirect](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-redirect)
- [seed-resource-not-found](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-not-found)
- [seed-resource-tombstone](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-tombstone)
- [seed-resource-error](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-error)

## Depends on

- [seed-resource-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-comment)
- [seed-resource-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-document)
- [seed-resource-error](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-error)
- [seed-resource-not-found](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-not-found)
- [seed-resource-redirect](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-redirect)
- [seed-resource-tombstone](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource-tombstone)
