---
name: Capability
summary: "A signed grant from a space owner to another key: a role (WRITER or AGENT), an optional path scope, and nothing that expires or revokes it."
schemaDefinition: ipfs://bafyreic6t7cjpkoib3hc6cy53it2x6al4xd6evwgq6trzco3uoq2eygmbe
---
A **capability** is the blob that lets someone other than the space owner write into a [space](./protocol/identity.md). The owner signs it, names the key that receives the grant (the `delegate`), picks a [role](./role.md), and optionally limits it to a path. Every node checks [Refs](./ref.md) against the capabilities it has stored, so the whole network enforces the grant. [Permissions](./protocol/permissions.md) has the full model, the exact authorization rule and a worked example. <!-- id:EoJZUC30 -->

The `signer` is both the issuer and the space. Only the space owner's key can sign a capability for that space, so a delegate cannot issue grants in it. Any delegate can still pass its authority one more hop by making another key its AGENT. `role` is `WRITER` (publish under the path and everything beneath it) or `AGENT` (act as the issuer; the path must be empty). `path` scopes by segment and is always recursive: a grant at `/team` covers `/team/notes` but not `/teammates`. `label` is a public, immutable note of at most 512 bytes. `audience` appears only on the short-lived, unstored capabilities that peers and HTTP clients sign to prove they hold an account. A stored grant never sets it. <!-- id:Q9nzk6HJ -->

There is no expiry and no revocation. A capability that names a Ref's signer gives the same result whether it arrives before that Ref or after it: the daemon stashes an unauthorized Ref and retries it when a capability naming its signer is indexed. A late grant one hop up an AGENT chain names a different key and does not trigger that retry. An AGENT delegate inherits the issuer's own space and the issuer's direct grants elsewhere for exactly one hop. <!-- id:bbIv8daq -->

Create one with `seed-cli capability create --delegate <uid> --role WRITER --path /team` in the [CLI](./build/cli.md), with `createCapability` in the [SDK](./build/sdk.md), from a document's Collaborators view in the [Seed app](./apps/desktop.md), or with the agent [write](./agent/write.md) action `capability.grant`. <!-- id:jBYfdmtC -->

# Shape <!-- id:Z4Q_8BDH -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:r1SXPido -->
  - `type`: `"Capability"` <!-- id:SyOFox8W -->
  - `delegate` _(required)_: [principal](./principal.md) <!-- id:kjRR_hac -->
  - `audience`: [principal](./principal.md) <!-- id:7U5hD2qS -->
  - `path`: [string](./string.md) <!-- id:1kkgb2vD -->
  - `role`: [role](./role.md) <!-- id:rR-UJPdL -->
  - `label`: [string](./string.md) <!-- id:vvjLBzH9 -->

# Depends on <!-- id:8jobVV8F -->

- [blob](./blob.md) <!-- id:-Km-MHD- -->
- [principal](./principal.md) <!-- id:3nHrzASo -->
- [role](./role.md) <!-- id:-FedhZti -->
- [string](./string.md) <!-- id:C6Jjf4J4 -->

# See also <!-- id:JzIvRXS3 -->

- [Permissions](./protocol/permissions.md): the authorization rule and worked examples. <!-- id:rEyMVNK2 -->
- [role](./role.md): what WRITER and AGENT allow. <!-- id:00j3rR-u -->
- [ref](./ref.md): the blob a capability authorizes. <!-- id:nPTFzDGp -->
- [profile](./profile.md): aliases that need an AGENT capability. <!-- id:5kxmRArX -->
- [Identity](./protocol/identity.md): accounts, spaces and linked keys. <!-- id:3-S5A_HA -->
- [blob](./blob.md): the signed envelope. <!-- id:wD2G2_Id -->
