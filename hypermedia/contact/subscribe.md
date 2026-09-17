---
name: Contact Subscription
summary: "The two follow flags on a contact: site means the account joined the subject's site, profile means it follows the subject as a person."
schemaDefinition: ipfs://bafyreiffn2muh7nguv2vdbb7rgfafh4fmhlc425h4dqbzcbxeu3lwpmxhq
---
The **subscribe** struct on a [contact](../contact.md) carries two booleans. `site: true` records that the signing account joined the subject's site, which is what puts it in that site's members list. `profile: true` records that it follows the subject's profile. Both may be set; a contact with neither is treated by the apps as a legacy follow. <!-- id:O3n3Cn_O -->

These flags are the whole of what "join" and "follow" mean on the network. The daemon stores and returns them and does nothing else with them: they grant no permission, affect no visibility, and create no sync subscription. The Seed apps read them to render Joined and Following lists and to decide whether to sync or send notifications. Note that the daemon's own contact RPCs cannot set them; only clients that build the contact blob themselves, such as the SDK and the apps, do. The Seed CLI's `contact create` has no option for them either. See [Permissions](../protocol/permissions.md). <!-- id:cyeDyA37 -->

# Shape <!-- id:u3UrzpQ1 -->

A **closed struct** with these fields: <!-- id:_ytcLXM1 -->
  - `site`: [boolean](../boolean.md) <!-- id:3ldQ_dA1 -->
  - `profile`: [boolean](../boolean.md) <!-- id:_b3klfc7 -->

# Depends on <!-- id:4YYxJr-6 -->

- [boolean](../boolean.md) <!-- id:LxIPmPhY -->
