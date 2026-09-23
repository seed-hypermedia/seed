---
name: Collaborators Payload
summary: "A document’s collaboration picture: the publisher, inherited and directly granted capabilities, effective members, and their metadata."
---
Who can work on a [document](../../protocol/documents.md): the publisher, inherited and directly granted [capabilities](../../protocol/permissions.md), the effective [members](./site-member.md), and their metadata. [rpc/list-document-collaborators](../list-document-collaborators.md) returns it. <!-- id:qppfw6ji -->

This page describes the **rpc/type/collaborators-payload** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:o_ipNuGi -->

# See also <!-- id:uUQ40NTq -->

- [ListDocumentCollaborators](../list-document-collaborators.md): the method that returns it. <!-- id:glNOoMy9 -->
- [Capability (Payload)](./capability.md): each granted capability. <!-- id:abHkXd29 -->
- [Site Member](./site-member.md): each member. <!-- id:_P3W7gBO -->
- [Permissions](../../protocol/permissions.md): how capabilities and roles work. <!-- id:Vu92RQQ6 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:701Kv6C9 -->
