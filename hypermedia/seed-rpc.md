---
name: RPC
summary: The union of every read-only method of the Seed universal-client API. Each variant pins a method key and types its input and output — the machine-readable catal
schemaDefinition: ipfs://bafyreihhjvncl2nysgxivymh7tezm63njjsy2qoztoziit7zxgitht7rky
---
The union of every read-only method of the Seed universal-client API. Each variant pins a method key and types its input and output — the machine-readable catalog the in-app API console is driven by. <!-- id:IKHnPUjW -->

This document describes the **seed-rpc** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fcTIA-2I -->

# Shape <!-- id:s2nSHzDT -->

A **union** — a value matches one of these variants: <!-- id:t3jRiLMY -->
  - [seed-rpc-account](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account) <!-- id:_zdwVhsO -->
  - [seed-rpc-account-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account-contacts) <!-- id:IqFdeR_2 -->
  - [seed-rpc-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-comment) <!-- id:5YXd9d3k -->
  - [seed-rpc-discovery-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-discovery-status) <!-- id:jkhEqdEt -->
  - [seed-rpc-get-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-cid) <!-- id:LUhMVh34 -->
  - [seed-rpc-get-comment-reply-count](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-comment-reply-count) <!-- id:1Rr7FgPf -->
  - [seed-rpc-get-domain](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-domain) <!-- id:0LnHqzFT -->
  - [seed-rpc-interaction-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-interaction-summary) <!-- id:Faah23cw -->
  - [seed-rpc-list-accounts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-accounts) <!-- id:0egUykJH -->
  - [seed-rpc-list-capabilities](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-capabilities) <!-- id:UEXQpQCv -->
  - [seed-rpc-list-changes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-changes) <!-- id:4Psq8a8V -->
  - [seed-rpc-list-citations](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-citations) <!-- id:JdIMcAxO -->
  - [seed-rpc-list-comment-versions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comment-versions) <!-- id:wwlfnAPm -->
  - [seed-rpc-list-comments](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments) <!-- id:tjrP0ESL -->
  - [seed-rpc-list-comments-by-author](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-author) <!-- id:g4SnZz3f -->
  - [seed-rpc-list-comments-by-reference](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-reference) <!-- id:Ipo3hZ1Z -->
  - [seed-rpc-list-discussions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-discussions) <!-- id:EJ8D2Uj_ -->
  - [seed-rpc-list-document-collaborators](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-document-collaborators) <!-- id:dafnirTy -->
  - [seed-rpc-list-domains](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-domains) <!-- id:WB2m2NRz -->
  - [seed-rpc-list-events](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-events) <!-- id:W82We2TQ -->
  - [seed-rpc-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query) <!-- id:AZtS9Yen -->
  - [seed-rpc-query-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query-block) <!-- id:8R_--oQy -->
  - [seed-rpc-resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource) <!-- id:UAeE03eg -->
  - [seed-rpc-resource-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource-metadata) <!-- id:xVZZIx5p -->
  - [seed-rpc-search](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-search) <!-- id:_RsT4zb8 -->
  - [seed-rpc-subject-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-subject-contacts) <!-- id:4a0eVGin -->

# Depends on <!-- id:boCxdBC1 -->

- [seed-rpc-account](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account) <!-- id:oc4Xfb5J -->
- [seed-rpc-account-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account-contacts) <!-- id:J6t7VVeu -->
- [seed-rpc-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-comment) <!-- id:MMU-q7vJ -->
- [seed-rpc-discovery-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-discovery-status) <!-- id:fHUxd640 -->
- [seed-rpc-get-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-cid) <!-- id:fW8-sce5 -->
- [seed-rpc-get-comment-reply-count](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-comment-reply-count) <!-- id:6Q48hzuw -->
- [seed-rpc-get-domain](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-domain) <!-- id:UIXwk8GE -->
- [seed-rpc-interaction-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-interaction-summary) <!-- id:ZqKxNHCY -->
- [seed-rpc-list-accounts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-accounts) <!-- id:LwY38V_j -->
- [seed-rpc-list-capabilities](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-capabilities) <!-- id:YAM_BeOc -->
- [seed-rpc-list-changes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-changes) <!-- id:sIrXghV1 -->
- [seed-rpc-list-citations](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-citations) <!-- id:Ux-c24sV -->
- [seed-rpc-list-comment-versions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comment-versions) <!-- id:U66hJEPE -->
- [seed-rpc-list-comments](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments) <!-- id:Hj9oCYjo -->
- [seed-rpc-list-comments-by-author](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-author) <!-- id:V5Ht5n2Z -->
- [seed-rpc-list-comments-by-reference](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-reference) <!-- id:_FFnNnsN -->
- [seed-rpc-list-discussions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-discussions) <!-- id:pvyxHpBB -->
- [seed-rpc-list-document-collaborators](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-document-collaborators) <!-- id:2xinDu-A -->
- [seed-rpc-list-domains](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-domains) <!-- id:vbDBG2r2 -->
- [seed-rpc-list-events](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-events) <!-- id:6hA85Z9V -->
- [seed-rpc-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query) <!-- id:SXWoqR4k -->
- [seed-rpc-query-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query-block) <!-- id:nqKTdUUH -->
- [seed-rpc-resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource) <!-- id:JM_5oQGs -->
- [seed-rpc-resource-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource-metadata) <!-- id:yndytQRG -->
- [seed-rpc-search](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-search) <!-- id:fF0JDz5h -->
- [seed-rpc-subject-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-subject-contacts) <!-- id:mpRvoduy -->
