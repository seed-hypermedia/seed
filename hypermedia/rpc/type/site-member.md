---
name: Site Member
summary: "One member of a site with their effective role: owner, writer, or member."
schemaDefinition: ipfs://bafyreiaczyeizz757pdb5pvkrcljqfovvcm57qmj3l7fud2dmbsb6rcuni
---
This page describes the **rpc/type/site-member** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:H3mBSjt5 -->

# Shape <!-- id:7NSDhta8 -->

A **closed struct** with these fields: <!-- id:FIu9UTGK -->
  - `account` _(required)_: [rpc/type/id](./id.md) <!-- id:CdShRyF7 -->
  - `role` _(required)_: one of `"owner"` | `"writer"` | `"member"` <!-- id:rQoJfwbo -->

# Depends on <!-- id:T1nSmVgV -->

- [rpc/type/id](./id.md) <!-- id:DF2i2UIT -->
