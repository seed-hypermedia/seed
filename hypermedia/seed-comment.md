---
name: Comment (payload)
summary: "A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A d"
schemaDefinition: ipfs://bafyreicgtyav5a2qlbgi4langlz5tjsxk3qhfqgv2pyt6c5nxzwgi53ok4
---
A comment as the API returns it to clients: the signed comment's content plus derived fields (stable id, version CID, thread links, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:3cDEwf1- -->

This document describes the **seed-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:dubklf6x -->