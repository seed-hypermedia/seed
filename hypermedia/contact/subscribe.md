---
name: Contact Subscription
summary: "The two follow flags on a contact: site means the account joined the subject's site, profile means it follows the subject as a person."
---
The **subscribe** [struct](../struct.md) on a [contact](../contact.md) holds two true-or-false flags. `site: true` records that the signing [account](../protocol/identity.md) joined the subject's [site](../protocol/sites.md). That puts it in the site's list of members. `profile: true` records that it follows the subject's [profile](../profile.md). Both may be set. The apps treat a contact with neither flag as a plain follow. [Contacts](../protocol/contacts.md) explains joining and following. <!-- id:O3n3Cn_O -->

These flags are all that "join" and "follow" mean on the network. The [daemon](../software/daemon.md) stores and returns them and does nothing else with them. They grant no permission, change no [visibility](../visibility.md), and create no [sync subscription](../protocol/network.md). The [Seed app](../software/desktop.md) reads them to show the Joined and Following lists, and to decide whether to sync or send notifications. The daemon's own contact RPCs cannot set them. Only clients that build the contact [blob](../protocol/blobs.md) themselves can, such as the [SDK](../build/sdk.md) and the apps. The Seed [CLI](../build/cli.md)'s `contact create` has no option for them either. See [Contacts](../protocol/contacts.md). <!-- id:cyeDyA37 -->

# See also <!-- id:HppIWhhg -->

- [contact](../contact.md): the blob that carries these flags. <!-- id:j05CBKhK -->
- [Contacts](../protocol/contacts.md): joins, follows and membership. <!-- id:iul56CzM -->
- [Sites](../protocol/sites.md): site members. <!-- id:wB8eehzg -->
- [Network](../protocol/network.md): how sync subscriptions work. <!-- id:jjVU39zz -->
