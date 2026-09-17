---
name: Role
summary: "The kind of capability being granted: WRITER may publish under a path, AGENT may act as the issuing account; no other role exists in data."
schemaDefinition: ipfs://bafyreigljshxokw5gh2nmtuinwrje5up32j7dzel2zg7gf3g6decc3owfm
---
A **role** is the coarse kind of authority a [capability](./capability.md) grants. Hypermedia has no fine-grained permission lists. Exactly two roles exist in the network today. <!-- id:fB9u_VFJ -->
  - `WRITER` may publish [Refs](./ref.md) at the capability's path and every path beneath it: create, update, fork, move, delete and redirect documents there. A WRITER at the space root also counts as a collaborator for reading [private](./protocol/privacy.md) content over HTTP. A WRITER on a sub-path does not. For private peer sync, a WRITER at any path counts. <!-- id:_iXC_aCi -->
  - `AGENT` is full delegation of the issuer's key. It must have an empty path. An AGENT does everything the issuer can do in the issuer's space, signs the issuer's [profile](./profile.md), may alias itself to the issuer, and inherits the issuer's direct grants in other spaces for one hop. Devices and browser sessions are linked to an account this way. The name predates AI agents, and [Seed Agents](./agent.md) use it too. <!-- id:fWx3dHr_ -->

The values are upper-case for compatibility with the old protobuf enum names. Permanent data uses PascalCase everywhere else. An `EDITOR` role is reserved as a comment in the API definition and does not exist. Team designs that speak of owners, admins, members or subscribers describe product features, and none of them is a role in data. See [Permissions](./protocol/permissions.md) for what each role allows and where. <!-- id:b_QiA6zJ -->

# Shape <!-- id:54Qo2z9p -->

Kind: `string`. One of: `WRITER`, `AGENT`. <!-- id:wBrzi7da -->

# See also <!-- id:Gz3c_AJX -->

- [Permissions](./protocol/permissions.md): the authorization rule. <!-- id:ZZ-3CQl_ -->
- [capability](./capability.md): the blob that carries a role. <!-- id:LTmL7MY2 -->
- [Identity](./protocol/identity.md): linking devices with AGENT. <!-- id:T6RWpaR6 -->
- [Privacy](./protocol/privacy.md): who can read private content. <!-- id:ZA9ezGJr -->
