---
name: "Resource: document"
summary: "A resolved resource that is a document. A derived read model computed by the Seed daemon/API for clients — not a signed network blob."
---

# Resource: document

A resolved resource that is a document. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-resource-document** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `document`
- `id` *(required)* — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
- `document` *(required)* — [seed-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document)

## Depends on

- [seed-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document)
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
