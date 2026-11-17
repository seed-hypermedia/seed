---
name: Profile
summary: A snapshot blob giving an account its display name, avatar and description, or an alias that redirects one key to another; readers merge every profile for an account field by field.
---
A **profile** tells people who an [account](./protocol/identity.md) is. It has a `name`, an `avatar` (an `ipfs://` link to an image) and a `description`. A profile that is not an alias must have a `name`. A profile is a snapshot [blob](./protocol/blobs.md): each edit replaces it whole. It is always public. When a node serves an account, it collects every profile blob signed for that [space](./protocol/spaces.md) and merges them field by field. For each field it keeps the newest value by timestamp. So a name set on one device and an avatar set on another combine. The [home document](./protocol/spaces.md) is a separate [document](./protocol/documents.md). The profile gives the name and picture, and the home document gives the content of the [site](./protocol/sites.md). See [Identity](./protocol/identity.md). <!-- id:cZeSgsmH -->

`account` is set only when a delegated key signs the profile for another account. The [daemon](./software/daemon.md) accepts that only once the signer writes as that account through AGENT [capabilities](./protocol/permissions.md). Until then the blob waits in the stash. `alias` turns the blob into an identity redirect. It says "this key is really that account". A profile with `alias` must carry no other field. The daemon accepts it only if the aliased account issued the signer an AGENT capability. Otherwise the blob waits until such a capability arrives. Once an alias exists, asking for the delegated account returns only the account it points at. This is how a browser [session key](./build/sign-in.md) or a second device becomes part of one identity. It is the only way the protocol offers to move from one key to another. <!-- id:q1UPvUeR -->

You can set a profile in four ways. In the [CLI](./build/cli.md), run `seed-cli account profile set --name … --icon ipfs://… --description …`. In the [SDK](./build/sdk.md), call `createProfile` and `createProfileAlias` from the `blobs` module. In the [Seed app](./software/desktop.md), use the settings. From an [agent](./agent.md), use the [write](./agent/write.md) actions `profile.update` and `profile.alias`. <!-- id:2jXsuUZx -->

# See also <!-- id:FtxIRJ-W -->

- [Identity](./protocol/identity.md): accounts, aliases and linked keys. <!-- id:iYdCP0GH -->
- [capability](./capability.md): the AGENT grant an alias needs. <!-- id:BD3OW0In -->
- [contact](./contact.md): the name one account gives another. <!-- id:Fse-CNlu -->
- [principal](./principal.md): how the key is encoded. <!-- id:QrS5xiJl -->
- [blob](./blob.md): the signed envelope. <!-- id:amrIq187 -->
