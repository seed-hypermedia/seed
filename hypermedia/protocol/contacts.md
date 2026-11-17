---
name: Contacts
summary: A contact is one account's public name for another account, and this page explains how you follow a person, join a site and become a member, and why none of these gives a permission.
---
A [contact](../contact.md) is a public address-book entry. It says: "[account](./identity.md) A calls account S by this name". It also carries two flags. For example, Alice publishes a contact that names Bob's account "Bob from work".

A contact gives no permission. The [daemon](../software/daemon.md) never looks at a contact when it decides what a key may write or read. <!-- id:Ck7X4nVZ -->

This page explains what contacts are for. The [contact](../contact.md) type page lists the fields.

# Following, joining and membership <!-- id:pVqfd2gr -->

The Seed apps use the two flags in `subscribe` to record how you relate to an account:

- `site: true` means "I joined this [site](./sites.md)".
- `profile: true` means "I follow this person".
- A contact with neither flag counts as a plain follow.

To join a site, you publish a contact with `site: true`. To leave, you remove the flag or the contact. The People and Members views of a site list the accounts that published a joining contact. A [writer](./permissions.md) who joins appears as a member with their role. Membership gives no permission.

A contact speaks for an account, so the indexer accepts it only when its signer may write the root of that account's [space](./spaces.md): the account's key, a key that writes as it through AGENT capabilities, or a holder of a root WRITER capability. Otherwise the contact is stashed and retried when a capability arrives, like a [Ref](../ref.md). The daemon's own contact RPCs check the same rule first, so you get a clear error. The daemon never turns a contact into a sync [subscription](./network.md). The apps do that. See [Contact](../contact.md) and [Contact subscription](../contact/subscribe.md). <!-- id:9D0UX8Nq -->

# Identity and visibility

A contact is a snapshot [blob](./blobs.md): each edit is a whole new copy of the record. Its record id is `<account>/<tsid>`. A contact with an empty subject is a [tombstone](./documents.md), which marks the contact as deleted. Contacts are always public, and the daemon indexes them for search. So a name you gave someone shows up when you search for it.

# Contacts and trust

No code path lets one user's contacts change what a third party may read or write. The grants that do carry authority are [capabilities](./permissions.md).

# Working with contacts

You can create and remove contacts in four ways: <!-- id:uH8Ag0hn -->

- In the [CLI](../build/cli.md): `seed-cli contact create --subject <uid> --name "…"` and `seed-cli contact delete <id>`.
- In the [SDK](../build/sdk.md): `createContact` and `deleteContact`.
- In the [Seed app](../software/desktop.md): the Join and Follow buttons.
- From an [agent](../agent.md): the [write](../agent/write.md) actions `contact.create` and `contact.delete`.

A contact made with the CLI has neither flag, so it counts as a plain follow. Only the apps and the SDK's `createContact` can set `subscribe.site` or `subscribe.profile`.

On the [Seed API](../build/web-api.md), `GET /api/AccountContacts?__value=<uid>` and `GET /api/SubjectContacts?__value=<uid>` list contacts by owner and by subject. `GET /api/ListDocumentCollaborators?targetId=…` joins grants and joining contacts into the one list the app shows.

# See also

- [contact](../contact.md) and [contact/subscribe](../contact/subscribe.md): the fields and the flags.
- [Permissions](./permissions.md): what does grant write access.
- [Sites](./sites.md): what a site is, and its members.
- [Network](./network.md): subscriptions, which the apps create when you join.
- [Identity](./identity.md): accounts and [profiles](../profile.md).
