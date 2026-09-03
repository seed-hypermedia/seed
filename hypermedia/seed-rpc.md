---
name: RPC
summary: The union of every read-only method of the Seed universal-client API. Each variant pins a method key and types its input and output — the machine-readable catal
schemaDefinition: ipfs://bafyreiezctygae6tcqd4lvjf7nieypn335jbwitdi2wh37oswqii77j3la
---
The union of every read-only method of the Seed universal-client API. Each variant pins a method key and types its input and output — the machine-readable catalog the in-app API console is driven by. <!-- id:IKHnPUjW -->

This document describes the **seed-rpc** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fcTIA-2I -->

# Shape <!-- id:s2nSHzDT -->

A **union** — a value matches one of these variants: <!-- id:t3jRiLMY -->
  - [seed-rpc-account](./seed-rpc-account.md) <!-- id:_zdwVhsO -->
  - [seed-rpc-account-contacts](./seed-rpc-account-contacts.md) <!-- id:IqFdeR_2 -->
  - [seed-rpc-comment](./seed-rpc-comment.md) <!-- id:5YXd9d3k -->
  - [seed-rpc-discovery-status](./seed-rpc-discovery-status.md) <!-- id:jkhEqdEt -->
  - [seed-rpc-get-cid](./seed-rpc-get-cid.md) <!-- id:LUhMVh34 -->
  - [seed-rpc-get-comment-reply-count](./seed-rpc-get-comment-reply-count.md) <!-- id:1Rr7FgPf -->
  - [seed-rpc-get-domain](./seed-rpc-get-domain.md) <!-- id:0LnHqzFT -->
  - [seed-rpc-interaction-summary](./seed-rpc-interaction-summary.md) <!-- id:Faah23cw -->
  - [seed-rpc-list-accounts](./seed-rpc-list-accounts.md) <!-- id:0egUykJH -->
  - [seed-rpc-list-capabilities](./seed-rpc-list-capabilities.md) <!-- id:UEXQpQCv -->
  - [seed-rpc-list-changes](./seed-rpc-list-changes.md) <!-- id:4Psq8a8V -->
  - [seed-rpc-list-citations](./seed-rpc-list-citations.md) <!-- id:JdIMcAxO -->
  - [seed-rpc-list-comment-versions](./seed-rpc-list-comment-versions.md) <!-- id:wwlfnAPm -->
  - [seed-rpc-list-comments](./seed-rpc-list-comments.md) <!-- id:tjrP0ESL -->
  - [seed-rpc-list-comments-by-author](./seed-rpc-list-comments-by-author.md) <!-- id:g4SnZz3f -->
  - [seed-rpc-list-comments-by-reference](./seed-rpc-list-comments-by-reference.md) <!-- id:Ipo3hZ1Z -->
  - [seed-rpc-list-discussions](./seed-rpc-list-discussions.md) <!-- id:EJ8D2Uj_ -->
  - [seed-rpc-list-document-collaborators](./seed-rpc-list-document-collaborators.md) <!-- id:dafnirTy -->
  - [seed-rpc-list-domains](./seed-rpc-list-domains.md) <!-- id:WB2m2NRz -->
  - [seed-rpc-list-events](./seed-rpc-list-events.md) <!-- id:W82We2TQ -->
  - [seed-rpc-query](./seed-rpc-query.md) <!-- id:AZtS9Yen -->
  - [seed-rpc-query-block](./seed-rpc-query-block.md) <!-- id:8R_--oQy -->
  - [seed-rpc-resource](./seed-rpc-resource.md) <!-- id:UAeE03eg -->
  - [seed-rpc-resource-metadata](./seed-rpc-resource-metadata.md) <!-- id:xVZZIx5p -->
  - [seed-rpc-search](./seed-rpc-search.md) <!-- id:_RsT4zb8 -->
  - [seed-rpc-subject-contacts](./seed-rpc-subject-contacts.md) <!-- id:4a0eVGin -->

# Depends on <!-- id:boCxdBC1 -->

- [seed-rpc-account](./seed-rpc-account.md) <!-- id:oc4Xfb5J -->
- [seed-rpc-account-contacts](./seed-rpc-account-contacts.md) <!-- id:J6t7VVeu -->
- [seed-rpc-comment](./seed-rpc-comment.md) <!-- id:MMU-q7vJ -->
- [seed-rpc-discovery-status](./seed-rpc-discovery-status.md) <!-- id:fHUxd640 -->
- [seed-rpc-get-cid](./seed-rpc-get-cid.md) <!-- id:fW8-sce5 -->
- [seed-rpc-get-comment-reply-count](./seed-rpc-get-comment-reply-count.md) <!-- id:6Q48hzuw -->
- [seed-rpc-get-domain](./seed-rpc-get-domain.md) <!-- id:UIXwk8GE -->
- [seed-rpc-interaction-summary](./seed-rpc-interaction-summary.md) <!-- id:ZqKxNHCY -->
- [seed-rpc-list-accounts](./seed-rpc-list-accounts.md) <!-- id:LwY38V_j -->
- [seed-rpc-list-capabilities](./seed-rpc-list-capabilities.md) <!-- id:YAM_BeOc -->
- [seed-rpc-list-changes](./seed-rpc-list-changes.md) <!-- id:sIrXghV1 -->
- [seed-rpc-list-citations](./seed-rpc-list-citations.md) <!-- id:Ux-c24sV -->
- [seed-rpc-list-comment-versions](./seed-rpc-list-comment-versions.md) <!-- id:U66hJEPE -->
- [seed-rpc-list-comments](./seed-rpc-list-comments.md) <!-- id:Hj9oCYjo -->
- [seed-rpc-list-comments-by-author](./seed-rpc-list-comments-by-author.md) <!-- id:V5Ht5n2Z -->
- [seed-rpc-list-comments-by-reference](./seed-rpc-list-comments-by-reference.md) <!-- id:_FFnNnsN -->
- [seed-rpc-list-discussions](./seed-rpc-list-discussions.md) <!-- id:pvyxHpBB -->
- [seed-rpc-list-document-collaborators](./seed-rpc-list-document-collaborators.md) <!-- id:2xinDu-A -->
- [seed-rpc-list-domains](./seed-rpc-list-domains.md) <!-- id:vbDBG2r2 -->
- [seed-rpc-list-events](./seed-rpc-list-events.md) <!-- id:6hA85Z9V -->
- [seed-rpc-query](./seed-rpc-query.md) <!-- id:SXWoqR4k -->
- [seed-rpc-query-block](./seed-rpc-query-block.md) <!-- id:nqKTdUUH -->
- [seed-rpc-resource](./seed-rpc-resource.md) <!-- id:JM_5oQGs -->
- [seed-rpc-resource-metadata](./seed-rpc-resource-metadata.md) <!-- id:yndytQRG -->
- [seed-rpc-search](./seed-rpc-search.md) <!-- id:fF0JDz5h -->
- [seed-rpc-subject-contacts](./seed-rpc-subject-contacts.md) <!-- id:mpRvoduy -->
