---
name: Contact
summary: "A public address-book entry: one account's name for another account, with flags that say whether it joined that account's site or follows its profile."
schemaDefinition: ipfs://bafyreibmuvwe6vynr2oahkg7toc43uhlkokfsz3kqlkx2dez2wljvmdkry
---
A **contact** is a public, signed statement by one account about another: "I call this account _name_", plus two flags in `subscribe` that the Seed apps use for joining a site and following a person. It is the Hypermedia version of a phone's contact list, except that it is published, and it is not a permission: the daemon never consults contacts when deciding what a key may read or write. See [Permissions](./protocol/permissions.md). <!-- id:LPwoGs-L -->

`subject` is the account being described; a contact with an empty subject is a tombstone that deletes an earlier record. `name` is the edge name, up to 256 bytes. `account` is set only when the signer is a delegated key writing on behalf of another account. `id` appears on updates and tombstones and holds the TSID of the record being replaced; a contact's record ID is written `<account>/<tsid>`. Contacts are always public and are indexed for search, which is why a name you gave someone shows up when you search for it. <!-- id:iCCMbigT -->

The [subscribe](./contact/subscribe.md) flags mean: `site: true`, I joined this site; `profile: true`, I follow this person. A legacy contact with neither flag counts as a follow. Joining a site is publishing such a contact; the site's members list is derived from them. The daemon only echoes these flags; turning a join into a sync subscription or a notification preference is the client's job. <!-- id:4eXue5uk -->

Create and remove contacts with `seed-cli contact create --subject <uid> --name "…"` and `seed-cli contact delete <id>`, with `createContact` and `deleteContact` in the SDK, with the Join and Follow buttons in the Seed app, or with the agent `write` actions `contact.create` and `contact.delete`. <!-- id:uH8Ag0hn -->

# Shape <!-- id:ME2Gye2p -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:WjOZXUDV -->
  - `type`: `"Contact"` <!-- id:NIqiWA2a -->
  - `id`: [string](./string.md) <!-- id:3n_-393R -->
  - `account`: [principal](./principal.md) <!-- id:zI4HdIy8 -->
  - `subject`: [principal](./principal.md) <!-- id:bkt0fx8L -->
  - `name`: [string](./string.md) <!-- id:SQCjgwlt -->
  - `subscribe`: [contact/subscribe](./contact/subscribe.md) <!-- id:EtgdYE7E -->

# Depends on <!-- id:5LiFHG4S -->

- [blob](./blob.md) <!-- id:WeX8VjDl -->
- [contact/subscribe](./contact/subscribe.md) <!-- id:id0JfSFv -->
- [principal](./principal.md) <!-- id:x0-Ea1K- -->
- [string](./string.md) <!-- id:BjAJTc65 -->
