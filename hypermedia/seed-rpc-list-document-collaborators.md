---
name: "RPC: ListDocumentCollaborators"
summary: "Resolves a document's full collaboration picture. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you"
schemaDefinition: ipfs://bafyreifyiib2fxinzot74ougthat5pavve5apoyrb2nue7jexjorad3ybq
---
Resolves a document's full collaboration picture. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:SpxLa0Jx -->

This document describes the **seed-rpc-list-document-collaborators** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:av_BQwYg -->

# Shape <!-- id:QWP-bfOj -->

A **closed struct** with these fields: <!-- id:EdUzp_Jx -->
  - `key` _(required)_ — `string` enum: `ListDocumentCollaborators` <!-- id:p-hlomXS -->
  - `input` _(required)_ — map { 1 fields } <!-- id:L0_8TywV -->
  - `output` _(required)_ — [seed-collaborators-payload](./seed-collaborators-payload.md) <!-- id:YQbNwJ0I -->

# Depends on <!-- id:vUoviOBz -->

- [seed-collaborators-payload](./seed-collaborators-payload.md) <!-- id:7mZJBG2y -->
- [seed-id](./seed-id.md) <!-- id:w9pYis7F -->
