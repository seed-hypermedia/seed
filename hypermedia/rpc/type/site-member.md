---
name: Site Member
summary: "One member of a site with their effective role: owner, writer, or member."
schemaDefinition: ipfs://bafyreiaczyeizz757pdb5pvkrcljqfovvcm57qmj3l7fud2dmbsb6rcuni
---
One member of a [site](../../protocol/sites.md) with their effective [role](../../protocol/permissions.md): owner, writer or member. The [collaborators payload](./collaborators-payload.md) lists them.

This page describes the **rpc/type/site-member** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:H3mBSjt5 -->

# Shape <!-- id:7NSDhta8 -->

A **closed struct** with these fields: <!-- id:FIu9UTGK -->
  - `account` _(required)_: [rpc/type/id](./id.md) <!-- id:CdShRyF7 -->
  - `role` _(required)_: one of `"owner"` | `"writer"` | `"member"` <!-- id:rQoJfwbo -->

# Depends on <!-- id:T1nSmVgV -->

- [rpc/type/id](./id.md) <!-- id:DF2i2UIT -->

# See also

- [Collaborators Payload](./collaborators-payload.md): the payload that lists members.
- [Permissions](../../protocol/permissions.md): roles and membership.
- [Role](../../role.md): the capability role enum.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
