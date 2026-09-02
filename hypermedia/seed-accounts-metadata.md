---
name: Accounts metadata
summary: Account uid -> resolved metadata payload, sent alongside listings so clients can render authors without extra requests. A derived read model computed by the See
schemaDefinition: ipfs://bafyreiaovxw5nj47rjzc7nd4ojgrf2csibv7ilqwuwbebmn3u3dzmyiu64
---
Account uid -> resolved metadata payload, sent alongside listings so clients can render authors without extra requests. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:ytAJ6HkR -->

This document describes the **seed-accounts-metadata** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:0FrTmY7Y -->