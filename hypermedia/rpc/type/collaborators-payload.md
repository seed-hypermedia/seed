---
name: Collaborators Payload
summary: "A document’s collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata."
schemaDefinition: ipfs://bafyreidqlgamlbt2kga4eba2pfp3rmaat5urwgt2wucbr4tw4p7dogenva
---
Who can work on a [document](../../protocol/documents.md): the publisher, inherited and directly granted [capabilities](../../protocol/permissions.md), the effective [members](./site-member.md), and their metadata. [rpc/list-document-collaborators](../list-document-collaborators.md) returns it. <!-- id:qppfw6ji -->

This page describes the **rpc/type/collaborators-payload** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:o_ipNuGi -->

# Shape <!-- id:0pHZWhFV -->

A **closed struct** with these fields: <!-- id:aPWcE-eZ -->
  - `publisherUid` _(required)_: [string](../../string.md) <!-- id:dNxcOhZ0 -->
  - `parentCapabilities` _(required)_: list of [rpc/type/capability](./capability.md) <!-- id:1Qe1cDdo -->
  - `grantedCapabilities` _(required)_: list of [rpc/type/capability](./capability.md) <!-- id:F1LujJDo -->
  - `grantedMembers` _(required)_: list of [rpc/type/site-member](./site-member.md) <!-- id:MgzEcRK6 -->
  - `members` _(required)_: list of [rpc/type/site-member](./site-member.md) <!-- id:0jqsG9an -->
  - `accounts` _(required)_: [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:iTCASGut -->

# Depends on <!-- id:EuNEDEuM -->

- [string](../../string.md) <!-- id:wh5e0WNl -->
- [rpc/type/accounts-metadata](./accounts-metadata.md) <!-- id:VDls_Pgs -->
- [rpc/type/capability](./capability.md) <!-- id:DNmDsWAi -->
- [rpc/type/site-member](./site-member.md) <!-- id:0RjtWQQY -->

# See also <!-- id:uUQ40NTq -->

- [ListDocumentCollaborators](../list-document-collaborators.md): the method that returns it. <!-- id:glNOoMy9 -->
- [Capability (Payload)](./capability.md): each granted capability. <!-- id:abHkXd29 -->
- [Site Member](./site-member.md): each member. <!-- id:_P3W7gBO -->
- [Permissions](../../protocol/permissions.md): how capabilities and roles work. <!-- id:Vu92RQQ6 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:701Kv6C9 -->
