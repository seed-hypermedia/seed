---
name: Capability
summary: "A signed grant from a space owner to another key: a role (WRITER or AGENT), an optional path scope, and nothing that expires or revokes it."
---
A **capability** is a signed grant. It lets a key other than the owner write into a [space](./protocol/spaces.md). The owner signs this [blob](./protocol/blobs.md), names the key that receives the grant (the `delegate`), picks a [role](./role.md), and can limit the grant to a path. Every node checks [Refs](./ref.md) against the capabilities it has stored, so the whole network enforces the grant. [Permissions](./protocol/permissions.md) has the full model, the exact rule and a worked example. <!-- id:EoJZUC30 -->

# Fields

A capability has these fields. `type`, `signer`, `sig` and `ts` are the signed [blob](./blob.md) envelope. The `signer` is both the issuer and the space.

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

`path` limits the grant by whole path segments, and always covers everything under it. A grant at `/team` covers `/team/notes` but not `/teammates`. An `AGENT` capability must have an empty path. The role name does not mean an AI [agent](./agent.md). `audience` appears only on short-lived capabilities that are never stored. Peers and HTTP clients sign those to prove they hold an account. <!-- id:Q9nzk6HJ -->

A capability does not expire, and nothing revokes it. An AGENT delegate writes wherever the issuer can, in the issuer's own space and in spaces the issuer was granted, and AGENT chains compose. It never gets the issuer's ownership. [Permissions](./protocol/permissions.md) explains the authorization rule, how AGENT chains compose, and what happens to a Ref that arrives before its grant. <!-- id:bbIv8daq -->

# See also <!-- id:JzIvRXS3 -->

- [Permissions](./protocol/permissions.md): the authorization rule and worked examples. <!-- id:rEyMVNK2 -->
- [role](./role.md): what WRITER and AGENT allow. <!-- id:00j3rR-u -->
- [ref](./ref.md): the blob a capability authorizes. <!-- id:nPTFzDGp -->
- [profile](./profile.md): aliases that need an AGENT capability. <!-- id:5kxmRArX -->
- [Identity](./protocol/identity.md): accounts, spaces and linked keys. <!-- id:3-S5A_HA -->
- [blob](./blob.md): the signed envelope. <!-- id:wD2G2_Id -->
