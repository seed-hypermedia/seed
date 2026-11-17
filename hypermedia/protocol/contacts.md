---
name: Contacts
summary: A contact is one account's public name for another account, and this page explains following a person, joining a site, membership, and why none of them grants a permission.
---
A [contact](../contact.md) is a public address-book entry: "account A calls subject S by this name", plus two flags. A contact grants no permission. The daemon never consults a contact when deciding what a key may write or read. <!-- id:Ck7X4nVZ -->

This page explains what contacts are for. The [contact](../contact.md) type page is the reference for the fields.

# Following, joining and membership <!-- id:pVqfd2gr -->

The flags in `subscribe` are how the Seed apps model relationships: `site: true` means "I joined this [site](./sites.md)" and `profile: true` means "I follow this person". A contact with neither flag is treated as a legacy follow. To join a site, you publish such a contact. To leave, you remove the flag or the contact. The People and Members views of a site come from who has published a joining contact, and a writer who joins appears as a member with their role. Membership grants no permission. The indexer does not validate who signs a contact on whose behalf, but the daemon's own contact RPCs check the writer rule first. The daemon never turns a contact into a sync subscription. The apps do that. See [Contact](../contact.md) and [Contact subscription](../contact/subscribe.md). <!-- id:9D0UX8Nq -->

# Identity and visibility

A contact is a snapshot [blob](./blobs.md). Its record id is `<account>/<tsid>`, an edit replaces the whole record, and a contact with an empty subject is a tombstone. Contacts are always public and are indexed for search, so a name you gave someone shows up when you search for it.

# Contacts and trust

Contacts have no permission effect, and the indexer does not validate who signs them. No code path lets one user's contacts change what a third party may read or write. The grants that do carry authority are [capabilities](./permissions.md).

# Working with contacts

Create and remove contacts with `seed-cli contact create --subject <uid> --name "…"` and `seed-cli contact delete <id>` in the [CLI](../build/cli.md), with `createContact` and `deleteContact` in the [SDK](../build/sdk.md), with the Join and Follow buttons in the [Seed app](../software/desktop.md), or with the agent [write](../agent/write.md) actions `contact.create` and `contact.delete`. <!-- id:uH8Ag0hn -->

On the [Seed API](../build/web-api.md), `GET /api/AccountContacts?__value=<uid>` and `GET /api/SubjectContacts?__value=<uid>` list contacts by owner and by subject. `GET /api/ListDocumentCollaborators?targetId=…` combines grants and joining contacts into the view the app shows.

# See also

- [contact](../contact.md) and [contact/subscribe](../contact/subscribe.md): the fields and the flags.
- [Permissions](./permissions.md): what does grant write access.
- [Sites](./sites.md): what a site is, and its members.
- [Network](./network.md): subscriptions, which the apps create when you join.
- [Identity](./identity.md): accounts and profiles.
