---
name: Resource
summary: "The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by "
schemaDefinition: ipfs://bafyreicdh6ygouxie6xlnfdikbtd6xz465aem3fz7h3oh54cw2t4yyopf4
---
The union of every state a fetched resource can be in: a document, a comment, a redirect, not found, a tombstone, or an error. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:DKrlmk-b -->

This document describes the **seed-resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:8qMDyX3F -->