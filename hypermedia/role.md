---
name: Role
summary: "The kind of capability being granted: WRITER may publish under a path, AGENT may act as the issuing account; no other role exists in data."
schemaDefinition: ipfs://bafyreigljshxokw5gh2nmtuinwrje5up32j7dzel2zg7gf3g6decc3owfm
---
A **role** is the coarse kind of authority a [capability](./capability.md) grants; Hypermedia has roles rather than fine-grained permission lists. Exactly two exist in the network today. <!-- id:fB9u_VFJ -->
  - `WRITER` may publish Refs at the capability's path and every path beneath it: create, update, fork, move, delete and redirect documents there. A WRITER at the space root also counts as a collaborator for reading private content; a WRITER on a sub-path does not. <!-- id:_iXC_aCi -->
  - `AGENT` is full delegation of the issuer's key. It must have an empty path. An AGENT does everything the issuer can do in the issuer's space, signs the issuer's profile, may alias itself to the issuer, and inherits the issuer's direct grants in other spaces for one hop. It is how devices and browser sessions are linked to an account; the name predates AI agents, though Seed Agents use it too. <!-- id:fWx3dHr_ -->

The values are upper-case for compatibility with the old protobuf enum names, unlike the PascalCase used elsewhere in permanent data. An `EDITOR` role is reserved as a comment in the API definition and does not exist; team designs that speak of owners, admins, members or subscribers describe products, not roles. See [Permissions](./protocol/permissions.md) for what each role unlocks and where. <!-- id:b_QiA6zJ -->

# Shape <!-- id:54Qo2z9p -->

Kind: `string`. One of: `WRITER`, `AGENT`. <!-- id:wBrzi7da -->
