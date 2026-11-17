---
name: Contact
summary: "A public address-book entry: one account's name for another account, with flags that say whether it joined that account's site or follows its profile."
---
A **contact** is a public, signed statement by one [account](./protocol/identity.md) about another: "I call this account _name_". It works like the contact list on a phone, but it is published. Its `subscribe` field has two flags. The [Seed app](./software/desktop.md) uses them for joining a site and for following a person. A contact grants nothing: the [daemon](./software/daemon.md) never looks at contacts when it decides what a key may read or write. [Contacts](./protocol/contacts.md) explains following, joining and membership. <!-- id:LPwoGs-L -->

`subject` is the account being described. A contact with an empty subject deletes an earlier record, like the [tombstone](./protocol/documents.md) of a document. `name` is the name the signer gives the subject, up to 256 bytes. `account` is set only when the signer is a delegated key that writes for another account. `id` appears on updates and deletions. It holds the [TSID](./protocol/blobs.md) of the record being replaced. A contact's record ID is written `<account>/<tsid>`. Contacts are always public and are indexed for search. So a name you gave someone shows up when you search for it. <!-- id:iCCMbigT -->

The [subscribe](./contact/subscribe.md) flags are `site: true`, meaning "I joined this [site](./protocol/sites.md)", and `profile: true`, meaning "I follow this person". A contact with neither flag counts as a follow. <!-- id:4eXue5uk -->

# See also <!-- id:C9ofKsUO -->

- [contact/subscribe](./contact/subscribe.md): the join and follow flags. <!-- id:Iw4J7xvH -->
- [Contacts](./protocol/contacts.md): following, joining and membership.
- [Permissions](./protocol/permissions.md): what does grant write access. <!-- id:L86Ul52D -->
- [profile](./profile.md): the name an account gives itself. <!-- id:2wBRY82P -->
- [Sites](./protocol/sites.md): site members. <!-- id:fM8XiSa4 -->
- [blob](./blob.md): the signed envelope. <!-- id:gsEkmi9E -->

# Pages in this section <!-- id:Y3p3WaVT attrs:{"childrenType":"Grid","columnCount":3} -->

<./contact/subscribe.md> <!-- id:FQQeqiLN type:Embed attrs:{"view":"Card"} -->
