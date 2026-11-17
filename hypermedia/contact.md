---
name: Contact
summary: "A public address-book entry: one account's name for another account, with flags that say whether it joined that account's site or follows its profile."
---
A **contact** is a public, signed statement by one [account](./protocol/identity.md) about another: "I call this account _name_". It has two flags in `subscribe` that the Seed apps use for joining a site and following a person. It works like a phone's contact list, but it is published. A contact grants nothing: the daemon never consults contacts when deciding what a key may read or write. [Contacts](./protocol/contacts.md) explains following, joining and membership. <!-- id:LPwoGs-L -->

`subject` is the account being described. A contact with an empty subject is a tombstone that deletes an earlier record. `name` is the edge name, up to 256 bytes. `account` is set only when the signer is a delegated key writing on behalf of another account. `id` appears on updates and tombstones and holds the [TSID](./protocol/blobs.md) of the record being replaced. A contact's record ID is written `<account>/<tsid>`. Contacts are always public and are indexed for search, so a name you gave someone shows up when you search for it. <!-- id:iCCMbigT -->

The [subscribe](./contact/subscribe.md) flags are `site: true`, I joined this [site](./protocol/sites.md), and `profile: true`, I follow this person. A contact with neither flag counts as a follow. <!-- id:4eXue5uk -->

# See also <!-- id:C9ofKsUO -->

- [contact/subscribe](./contact/subscribe.md): the join and follow flags. <!-- id:Iw4J7xvH -->
- [Contacts](./protocol/contacts.md): following, joining and membership.
- [Permissions](./protocol/permissions.md): contacts, joins and the web of trust. <!-- id:L86Ul52D -->
- [profile](./profile.md): the name an account gives itself. <!-- id:2wBRY82P -->
- [Sites](./protocol/sites.md): site members. <!-- id:fM8XiSa4 -->
- [blob](./blob.md): the signed envelope. <!-- id:gsEkmi9E -->

# Pages in this section <!-- id:Y3p3WaVT attrs:{"childrenType":"Grid","columnCount":3} -->

<./contact/subscribe.md> <!-- id:FQQeqiLN type:Embed attrs:{"view":"Card"} -->
