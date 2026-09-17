---
name: RPC
summary: The union of every read-only method of the Seed API, each variant pinning a method key and typing its input and output.
schemaDefinition: ipfs://bafyreihceqkz5ertrc6mrnefoj4b5ink2nczuogohthdbanucs26aeackm
---
The union of every read-only method of the [Seed API](../build/web-api.md). Each variant pins a method key and types its input and output. The app's [API console](../rpc.md) builds its method picker from this union. <!-- id:IKHnPUjW -->

This page describes the **rpc/method** union. Each method's output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:fcTIA-2I -->

# Shape <!-- id:s2nSHzDT -->

A **union**. A value matches one of these variants: <!-- id:t3jRiLMY -->
  - [rpc/account](./account.md) <!-- id:_zdwVhsO -->
  - [rpc/account-contacts](./account-contacts.md) <!-- id:IqFdeR_2 -->
  - [rpc/comment](./comment.md) <!-- id:5YXd9d3k -->
  - [rpc/discovery-status](./discovery-status.md) <!-- id:jkhEqdEt -->
  - [rpc/get-cid](./get-cid.md) <!-- id:LUhMVh34 -->
  - [rpc/get-comment-reply-count](./get-comment-reply-count.md) <!-- id:1Rr7FgPf -->
  - [rpc/get-domain](./get-domain.md) <!-- id:0LnHqzFT -->
  - [rpc/interaction-summary](./interaction-summary.md) <!-- id:Faah23cw -->
  - [rpc/list-accounts](./list-accounts.md) <!-- id:0egUykJH -->
  - [rpc/list-capabilities](./list-capabilities.md) <!-- id:UEXQpQCv -->
  - [rpc/list-changes](./list-changes.md) <!-- id:4Psq8a8V -->
  - [rpc/list-citations](./list-citations.md) <!-- id:JdIMcAxO -->
  - [rpc/list-comment-versions](./list-comment-versions.md) <!-- id:wwlfnAPm -->
  - [rpc/list-comments](./list-comments.md) <!-- id:tjrP0ESL -->
  - [rpc/list-comments-by-author](./list-comments-by-author.md) <!-- id:g4SnZz3f -->
  - [rpc/list-comments-by-reference](./list-comments-by-reference.md) <!-- id:Ipo3hZ1Z -->
  - [rpc/list-discussions](./list-discussions.md) <!-- id:EJ8D2Uj_ -->
  - [rpc/list-document-collaborators](./list-document-collaborators.md) <!-- id:dafnirTy -->
  - [rpc/list-domains](./list-domains.md) <!-- id:WB2m2NRz -->
  - [rpc/list-events](./list-events.md) <!-- id:W82We2TQ -->
  - [rpc/query](./query.md) <!-- id:AZtS9Yen -->
  - [rpc/query-block](./query-block.md) <!-- id:8R_--oQy -->
  - [rpc/resource](./resource.md) <!-- id:UAeE03eg -->
  - [rpc/resource-metadata](./resource-metadata.md) <!-- id:xVZZIx5p -->
  - [rpc/search](./search.md) <!-- id:_RsT4zb8 -->
  - [rpc/subject-contacts](./subject-contacts.md) <!-- id:4a0eVGin -->

# Depends on <!-- id:boCxdBC1 -->

- [rpc/account](./account.md) <!-- id:oc4Xfb5J -->
- [rpc/account-contacts](./account-contacts.md) <!-- id:J6t7VVeu -->
- [rpc/comment](./comment.md) <!-- id:MMU-q7vJ -->
- [rpc/discovery-status](./discovery-status.md) <!-- id:fHUxd640 -->
- [rpc/get-cid](./get-cid.md) <!-- id:fW8-sce5 -->
- [rpc/get-comment-reply-count](./get-comment-reply-count.md) <!-- id:6Q48hzuw -->
- [rpc/get-domain](./get-domain.md) <!-- id:UIXwk8GE -->
- [rpc/interaction-summary](./interaction-summary.md) <!-- id:ZqKxNHCY -->
- [rpc/list-accounts](./list-accounts.md) <!-- id:LwY38V_j -->
- [rpc/list-capabilities](./list-capabilities.md) <!-- id:YAM_BeOc -->
- [rpc/list-changes](./list-changes.md) <!-- id:sIrXghV1 -->
- [rpc/list-citations](./list-citations.md) <!-- id:Ux-c24sV -->
- [rpc/list-comment-versions](./list-comment-versions.md) <!-- id:U66hJEPE -->
- [rpc/list-comments](./list-comments.md) <!-- id:Hj9oCYjo -->
- [rpc/list-comments-by-author](./list-comments-by-author.md) <!-- id:V5Ht5n2Z -->
- [rpc/list-comments-by-reference](./list-comments-by-reference.md) <!-- id:_FFnNnsN -->
- [rpc/list-discussions](./list-discussions.md) <!-- id:pvyxHpBB -->
- [rpc/list-document-collaborators](./list-document-collaborators.md) <!-- id:2xinDu-A -->
- [rpc/list-domains](./list-domains.md) <!-- id:vbDBG2r2 -->
- [rpc/list-events](./list-events.md) <!-- id:6hA85Z9V -->
- [rpc/query](./query.md) <!-- id:SXWoqR4k -->
- [rpc/query-block](./query-block.md) <!-- id:nqKTdUUH -->
- [rpc/resource](./resource.md) <!-- id:JM_5oQGs -->
- [rpc/resource-metadata](./resource-metadata.md) <!-- id:yndytQRG -->
- [rpc/search](./search.md) <!-- id:fF0JDz5h -->
- [rpc/subject-contacts](./subject-contacts.md) <!-- id:mpRvoduy -->

# See also <!-- id:WY60lqm- -->

- [Seed API Schemas](../rpc.md): how the methods are published and the console. <!-- id:Eh4B2bQE -->
- [Seed API](../build/web-api.md): calling these keys over HTTP. <!-- id:iPUozo1L -->
- [SDK](../build/sdk.md): typed calls from TypeScript. <!-- id:kfjbyoNo -->
- [Resource](./resource.md): the most common read. <!-- id:tWF0cW-d -->
- [Search](./search.md): full-text search. <!-- id:d9IB0Vla -->
