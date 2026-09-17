---
name: Contact Subscription
summary: "The two follow flags on a contact: site means the account joined the subject's site, profile means it follows the subject as a person."
schemaDefinition: ipfs://bafyreiffn2muh7nguv2vdbb7rgfafh4fmhlc425h4dqbzcbxeu3lwpmxhq
---
The **subscribe** struct on a [contact](../contact.md) carries two booleans. `site: true` records that the signing account joined the subject's [site](../protocol/sites.md), which puts it in that site's members list. `profile: true` records that it follows the subject's [profile](../profile.md). Both may be set. The apps treat a contact with neither as a legacy follow. <!-- id:O3n3Cn_O -->

These flags are all that "join" and "follow" mean on the network. The daemon stores and returns them and does nothing else with them: they grant no permission, affect no [visibility](../visibility.md), and create no [sync subscription](../protocol/network.md). The Seed apps read them to render Joined and Following lists and to decide whether to sync or send notifications. The daemon's own contact RPCs cannot set them. Only clients that build the contact blob themselves, such as the [SDK](../build/sdk.md) and the apps, set them. The Seed [CLI](../build/cli.md)'s `contact create` has no option for them either. See [Permissions](../protocol/permissions.md). <!-- id:cyeDyA37 -->

# Shape <!-- id:u3UrzpQ1 -->

A **closed struct** with these fields: <!-- id:_ytcLXM1 -->
  - `site`: [boolean](../boolean.md) <!-- id:3ldQ_dA1 -->
  - `profile`: [boolean](../boolean.md) <!-- id:_b3klfc7 -->

# Depends on <!-- id:4YYxJr-6 -->

- [boolean](../boolean.md) <!-- id:LxIPmPhY -->

# See also <!-- id:HppIWhhg -->

- [contact](../contact.md): the blob that carries these flags. <!-- id:j05CBKhK -->
- [Permissions](../protocol/permissions.md): joins, follows and membership. <!-- id:iul56CzM -->
- [Sites](../protocol/sites.md): site members. <!-- id:wB8eehzg -->
- [Network](../protocol/network.md): how sync subscriptions work. <!-- id:jjVU39zz -->
