---
name: "RPC: ListDocumentCollaborators"
summary: "Resolves a document's full collaboration picture. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you"
---

# RPC: ListDocumentCollaborators

Resolves a document's full collaboration picture. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back.


This document describes the **seed-rpc-list-document-collaborators** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `key` *(required)* — `string` enum: `ListDocumentCollaborators`
- `input` *(required)* — map { 1 fields }
- `output` *(required)* — [seed-collaborators-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-collaborators-payload)

## Depends on

- [seed-collaborators-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-collaborators-payload)
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
