---
name: "RPC: GetCID"
summary: "Fetches a raw IPFS block by CID and decodes it. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you p"
schemaDefinition: ipfs://bafyreigjd7nvck5cn7di7utbhhsazffjye5tumn75r7dkydszcvikkmkoi
---
Fetches a raw IPFS block by CID and decodes it. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:KrdeFkDA -->

This document describes the **seed-rpc-get-cid** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:rPC2zBYZ -->

# Shape <!-- id:0EwBrMzm -->
A **closed struct** with these fields: <!-- id:HzFHBpWO -->
  - `key` _(required)_ — `string` enum: `GetCID` <!-- id:ZJCBLccu -->
  - `input` _(required)_ — map { 1 fields } <!-- id:AF0I_I1D -->
  - `output` _(required)_ — map { 1 fields } <!-- id:ERIh36-p -->

# Depends on <!-- id:ardnz0nd -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:xxcRpn4k -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:rLVe6evY -->