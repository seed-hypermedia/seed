---
name: Discovery Status
summary: "The state of a background discovery task for a resource: pending, found (with the resolved version), or failed (with the error). A derived read model computed b"
schemaDefinition: ipfs://bafyreig5qnttwnusga7cz46pf55yo53hjuzkcf2ssd6lxqo6darzfyj2ny
---
The state of a background discovery task for a resource: pending, found (with the resolved version), or failed (with the error). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:qgX0_Pnd -->

This document describes the **rpc/type/discovery-status** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Yrc4tz-K -->

# Shape <!-- id:5S7wQzcJ -->

A **closed struct** with these fields: <!-- id:30yArQuX -->
  - `state` _(required)_ — one of `"pending"` | `"found"` | `"failed"` <!-- id:9LZFnDbh -->
  - `version` — [string](../../string.md) <!-- id:8vEiaWJC -->
  - `error` — [string](../../string.md) <!-- id:7izs2ZlP -->

# Depends on <!-- id:2Ac_QMa3 -->

- [string](../../string.md) <!-- id:mvuguHT_ -->
