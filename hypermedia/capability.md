---
name: Capability
summary: "A signed grant from a space owner to another key: a role (WRITER or AGENT), an optional path scope, and nothing that expires or revokes it."
---
A **capability** is the blob that lets someone other than the space owner write into a [space](./protocol/spaces.md). The owner signs it, names the key that receives the grant (the `delegate`), picks a [role](./role.md), and optionally limits it to a path. Every node checks [Refs](./ref.md) against the capabilities it has stored, so the whole network enforces the grant. [Permissions](./protocol/permissions.md) has the full model, the exact authorization rule and a worked example. <!-- id:EoJZUC30 -->

# Fields

A capability adds these fields to the signed [blob](./blob.md) envelope. The `signer` is both the issuer and the space.

<!-- id:FvURpw93 -->
| Field <!-- col:XkxACv2l --> | Required <!-- col:Jiy7LkFM --> | Meaning <!-- col:Ws3UCr0G --> <!-- id:RMOQ2SHF --> |
| --- | --- | --- |
| `type` | yes | `"Capability"` <!-- id:YOuEerbW --> |
| `signer` | yes | the issuer, which is always the space owner <!-- id:ATxFH84v --> |
| `sig`, `ts` | yes | signature and issue time; the time is recorded but never compared with anything <!-- id:-sDGilAw --> |
| `delegate` | yes | the [principal](./principal.md) receiving the grant <!-- id:SI8uxynk --> |
| `role` | yes | `WRITER` or `AGENT` <!-- id:2z-SPqs8 --> |
| `path` | no | the scope; empty means the whole space <!-- id:jkOaP3w6 --> |
| `label` | no | a public, immutable note of at most 512 bytes <!-- id:D-mFB2aE --> |
| `audience` | no | used only by ephemeral authentication capabilities, never on stored grants <!-- id:BgEzfNch --> |

`path` scopes by segment and is always recursive: a grant at `/team` covers `/team/notes` but not `/teammates`. An `AGENT` capability must have an empty path. `audience` appears only on the short-lived, unstored capabilities that peers and HTTP clients sign to prove they hold an account. <!-- id:Q9nzk6HJ -->

There is no expiry and no revocation. [Permissions](./protocol/permissions.md) explains the authorization rule, the one-hop AGENT chain, and what happens to a Ref that arrives before its grant. <!-- id:bbIv8daq -->

# See also <!-- id:JzIvRXS3 -->

- [Permissions](./protocol/permissions.md): the authorization rule and worked examples. <!-- id:rEyMVNK2 -->
- [role](./role.md): what WRITER and AGENT allow. <!-- id:00j3rR-u -->
- [ref](./ref.md): the blob a capability authorizes. <!-- id:nPTFzDGp -->
- [profile](./profile.md): aliases that need an AGENT capability. <!-- id:5kxmRArX -->
- [Identity](./protocol/identity.md): accounts, spaces and linked keys. <!-- id:3-S5A_HA -->
- [blob](./blob.md): the signed envelope. <!-- id:wD2G2_Id -->
