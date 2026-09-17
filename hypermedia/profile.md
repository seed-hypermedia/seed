---
name: Profile
summary: A snapshot blob giving an account its display name, avatar and description, or an alias that redirects one key to another; readers merge every profile for an account field by field.
schemaDefinition: ipfs://bafyreich65btvsm2ibqgtjkd7ydk444wd56bi5qz2nrjvpwmlofplql2p4
---
A **profile** attaches human-facing information to an account key: a `name`, an `avatar` (an `ipfs://` link to an image), and a `description`. It is a snapshot blob, replaced whole on each edit, and always public. When a node serves an account it collects every profile blob signed for that space and merges them field by field, keeping the newest value of each by timestamp, so a name set on one device and an avatar set on another combine. The home document is separate: the profile gives the name and picture, the home document gives the site's content. See [Identity](./protocol/identity.md). <!-- id:cZeSgsmH -->

`account` is set only when a delegated key signs the profile on behalf of another account; the daemon accepts that only if the account issued the signer an AGENT [capability](./capability.md). `alias` turns the blob into an identity redirect: a profile with `alias` must carry no other field, and it says "this key is really that account". It is accepted only if the aliased account issued the signer an AGENT capability, otherwise the blob waits until such a capability arrives. Once an alias exists, asking for the delegated account returns only the account it points at. This is how a browser session key or a second device becomes part of one identity, and it is the only migration path the protocol offers between keys. <!-- id:q1UPvUeR -->

Set a profile with `seed-cli account profile set --name … --icon ipfs://… --description …`, with `createProfile` and `createProfileAlias` from the SDK's `blobs` module, in the Seed app's settings, or with the agent `write` actions `profile.update` and `profile.alias`. <!-- id:2jXsuUZx -->

# Shape <!-- id:_CVm1QUz -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:1UgKs7D_ -->
  - `type` — `"Profile"` <!-- id:N3u2-MXs -->
  - `alias` — [principal](./principal.md) <!-- id:4GNS3Kp_ -->
  - `name` — [string](./string.md) <!-- id:3XSac4Ad -->
  - `avatar` — [string](./string.md) <!-- id:3R4vEqDy -->
  - `description` — [string](./string.md) <!-- id:ITRFxA9m -->
  - `account` — [principal](./principal.md) <!-- id:6nYH0t9c -->

# Depends on <!-- id:yqwCrza_ -->

- [blob](./blob.md) <!-- id:5nAT-Ca0 -->
- [principal](./principal.md) <!-- id:XELjiLjq -->
- [string](./string.md) <!-- id:U1O1ayoB -->
