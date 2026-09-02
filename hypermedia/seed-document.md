---
name: Document (payload)
summary: "A document as the API returns it to clients: the signed document's metadata and content plus derived fields (resolved version, authors, timestamps, visibility)."
schemaDefinition: ipfs://bafyreidvlin4ind4v52mfrrrktny6jkkrs3s7v4enyqbe6j32zh544ny3a
---
A document as the API returns it to clients: the signed document's metadata and content plus derived fields (resolved version, authors, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:rHH1177g -->

This document describes the **seed-document** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QZ19vXgV -->