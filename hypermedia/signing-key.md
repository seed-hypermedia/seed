---
name: Signing Key
summary: "A field type for a private config: a signing key that the app environment holds for an app or agent, named by its account's `z6Mk…` principal, so the host's tools can publish as that account without ever seeing the key."
---
This page describes the **signing key** value type of [Hypermedia Schemas](./schema.md). It is a field type for the private config of an [app](./app.md) or an [agent](./agent.md), described by the host's `privateConfigSchema`. The formal schema of this type is attached to this [document](./protocol/documents.md) as the `schemaDefinition` key of its metadata.

A **signing key** value names a key that the [app environment](./software/app-environment.md) running the host keeps. The value is the key's [principal](./principal.md) in text form, `z6Mk…`: the [account](./protocol/identity.md) the key signs as. It is not the key itself. The key stays in the server's encrypted key store (its server accounts), and the private config only refers to it.

- **Attaching a key.** A writer of the host sets the field with `SetHostPrivateConfig` (see [host config](./build/signed-api-apps.md#host-config)). The server accepts only a key that the signer's own account holds on that server, so nobody can attach someone else's key. Removing the field (a `null`) detaches it, and any writer may do that.
- **What a tool sees.** In `ctx.privateConfig`, a signing-key field holds the account's principal. That is public information: it is the name to publish as, not a secret.
- **What it can write.** A key is an account. What it may write is decided by [capabilities](./protocol/permissions.md) granted to that account, not by the config.
- **Who holds its authority.** Anyone who can edit the host can change its tools, so attaching a key gives its capabilities to every writer of the host.

The pattern lets a validator check the shape without a lookup. `format: signing-key` tells an editor to give the field a key of its own: generate one in place for this host, or import an exported [key file](./build/keys.md). An editor does not offer the keys the server already holds, so a key is never reused by accident, and it warns before importing your own account key.

# See also

- [Principal](./principal.md): the key bytes this value names in text form.
- [Account](./account.md): a reference to an account as an `hm://` URL.
- [Running apps](./build/signed-api-apps.md): host config and the [signed API](./build/signed-api.md).
