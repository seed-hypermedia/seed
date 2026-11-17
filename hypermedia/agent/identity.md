---
name: Agent identity
summary: An agent signs what it publishes with its own keys, which the app environment creates and stores encrypted, and a person lets it write in their space by delegating a capability to that key.
---
An [agent](../agent.md) is an author on the network because it has a key. This page explains the agent's **signing identities**: what they are, where the keys live, which one the agent is by default, and how a person lets the agent publish in their space. It also covers how the app environment stores secrets.

# The agent's own keys

A signing identity is an Ed25519 key that belongs to the agent. Each one is a Seed [account](../protocol/identity.md) with a published [profile](../profile.md). The app environment creates the key (`CreateSigningIdentity`): it generates a new key on the server, publishes a profile with the given label, and stores the raw seed encrypted. In the app, **New Account** does this and also creates a [home document](../protocol/documents.md) that says the account is an agentic account.

The agent signs as one of its own identities. Its work is attributed to the agent, never to the person who owns it.

Hypermedia content must be signed on the device that holds the key, which is why Seed has no MCP server of its own; see [Why there is no Seed MCP server](../build/agents.md). An app environment does sign content, and that fits the same rule. The keys it signs with are the agent's own. `CreateSigningIdentity` generates a new key on that server, publishes a [profile](../protocol/identity.md) for it, and stores the key encrypted. Your account key stays on your device. For the agent to publish in your space, you delegate a `WRITER` or `AGENT` [capability](../protocol/permissions.md) to the agent's key. <!-- id:Q7N_J4rc -->

Agent keys are less secure than your personal identity by design, because the app environment holds them. That is one reason to give an agent its own key instead of your personal one. `ImportSigningIdentity`, the Import key button in the accounts dialog, sends the seed of an existing `.hmkey.json` [key](../build/keys.md) to the server, so only import a key made for the agent. If you don't want a hosted server to hold your agent keys, [self-host the app environment](../operate/self-hosted-app-environment.md). <!-- id:LrPb8BxH -->

# Granted identities and the primary account

Signing identities belong to the owner's account on the server. An agent may use the ones its owner granted to it: the agent's definition lists them as `signingKeys`.

One of them is the agent's **primary signing account**, named by `signingKey`. It is the account the agent *is*:

- writes sign as it unless the agent is asked to sign as another;
- mentions of it reach the agent, through the mention [trigger](./triggers.md) the server creates for it;
- it holds the agent's write access in the space of its [document](./mounting.md).

When `signingKey` names a key that is no longer granted, the first granted key is the primary.

Each turn, the model is given the granted identities as a list of profile names and public keys, primary first, so it can map a name a user says to the key to sign with. See [what an agent is told](./prompt.md). An agent with no signing identity cannot publish. The built-in [Assistant](./assistant.md) has none.

Publishing also needs the `publish` [grant](./grants.md). The identities are not used until it is on.

# Writing in a person's space

An agent's key can always publish in its own account's space. To publish inside a person's space, that person delegates a `WRITER` or `AGENT` [capability](../capability.md) to the agent's identity. Any collaborator gets the same delegation, and the [permissions](../protocol/permissions.md) page explains the roles. For a mounted agent the app does this when the agent is created; see [what the agent can write](./mounting.md). [Using Seed from your own agent](../build/agents.md) shows the delegation from the CLI.

A write to a space where the signer has no access is refused before it is published, with a message that names the missing capability.

# Managing identities

In the app, an agent's **Settings > Authorship identities** page lists the identities the agent may sign as, with **Grant** for an identity the server already holds and **New Account**. The **Server accounts** dialog, opened from Settings, lists every identity the account keeps on that server.

Managing identities is owner only, and the server enforces it. A collaborator sees only the identities granted to the shared agent, and a writer cannot change the granted set. See [sharing an agent](./sharing.md).

There is no general action that deletes a secret. A provider's API key is removed with its provider, and a signing key with `DeleteSigningIdentity`.

`UpdateSigningIdentity` republishes the account's profile with a new name or icon. `DeleteSigningIdentity` deletes the encrypted key from the server. Profiles already published stay on the network, because published blobs are append-only. `ListSigningIdentities` returns only redacted metadata. The shapes are in the [signed API](../build/signed-api.md).

# How secrets are stored

Signing keys, provider API keys, sign-in credentials and MCP header values are all **secrets** of an account. A secret is written once (`SetSecret` and the actions above) and never read back: every response carries only redacted metadata, and an account never sees another account's secrets.

Secrets are encrypted with AES-256-GCM under a 32-byte key that the server generates, with a fresh 12-byte nonce for every write. That key is stored in the same SQLite database as the secrets. This prevents disclosure through the API or the logs. It does not protect against someone who has the whole database. There is no key rotation, no secret versioning, and no storage of the key in an operating-system keychain or a key management service.

The shared client refuses to send a secret to a remote server over plain HTTP. A remote app environment must use HTTPS.

Secrets, decrypted keys, signed request bodies, full prompts and full session content are never written to the server's logs. See the [security model](./security.md).

# See also

- [Seed Agents](../agent.md)
- [Agents are documents](./mounting.md)
- [Sharing an agent](./sharing.md)
- [Security model](./security.md)
- [Identity](../protocol/identity.md)
- [Permissions](../protocol/permissions.md)
- [Keys](../build/keys.md)
- [MCP servers](./mcp.md)
