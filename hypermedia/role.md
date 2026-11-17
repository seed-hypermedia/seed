---
name: Role
summary: "The kind of capability being granted: WRITER may publish under a path, AGENT may act as the issuing account; no other role exists in data."
---
A **role** says what kind of power a [capability](./capability.md) grants. Hypermedia has no detailed permission lists. Exactly two roles exist. <!-- id:fB9u_VFJ -->
  - `WRITER` may publish [Refs](./ref.md) at the capability's path and at every path under it. So it may create, update, fork, move, delete and redirect [documents](./protocol/documents.md) there. A WRITER on the whole [space](./protocol/spaces.md) can also read [private](./protocol/privacy.md) content over HTTP. A WRITER on a sub-path cannot. For private [peer sync](./protocol/network.md), a WRITER at any path counts. <!-- id:_iXC_aCi -->
  - `AGENT` hands over the full power of the issuer's key. It must have an empty path. An AGENT does everything the issuer can do in the issuer's space. It signs the issuer's [profile](./profile.md), and it may alias itself to the issuer. It also gets the issuer's direct grants in other spaces, for one hop. This is how devices and browser sessions are linked to an account. The name does not mean an AI agent, though [Seed Agents](./agent.md) hold this role too. <!-- id:fWx3dHr_ -->

The values are upper-case to match the names of the protobuf enum. Everywhere else, permanent data uses PascalCase. The API definition mentions an `EDITOR` role only in a note in its source. That role does not exist. Team designs that speak of owners, admins, members or subscribers describe product features. None of them is a role in data. See [Permissions](./protocol/permissions.md) for what each role allows and where. <!-- id:b_QiA6zJ -->

# See also <!-- id:Gz3c_AJX -->

- [Permissions](./protocol/permissions.md): the authorization rule. <!-- id:ZZ-3CQl_ -->
- [capability](./capability.md): the [blob](./protocol/blobs.md) that carries a role. <!-- id:LTmL7MY2 -->
- [Identity](./protocol/identity.md): linking devices with AGENT. <!-- id:T6RWpaR6 -->
- [Privacy](./protocol/privacy.md): who can read private content. <!-- id:ZA9ezGJr -->
- [Catalogue of types](./schema/types.md): every type in the library.
