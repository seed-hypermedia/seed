---
name: Site member
summary: One member of a site with their effective role. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreie565bt243c5re4l3ukii23froizhyha4vryuhlmdo3wbbyozrkmm
---
This document describes the **seed-site-member** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:H3mBSjt5 -->

# Shape <!-- id:7NSDhta8 -->

A **closed struct** with these fields: <!-- id:FIu9UTGK -->
  - `account` _(required)_ — [seed-id](./seed-id.md) <!-- id:CdShRyF7 -->
  - `role` _(required)_ — `string` enum: `owner` `writer` `member` <!-- id:rQoJfwbo -->

# Depends on <!-- id:T1nSmVgV -->

- [seed-id](./seed-id.md) <!-- id:DF2i2UIT -->
