---
name: Agent identity
summary: An agent signs what it publishes with its own keys, which the app environment creates and stores encrypted, and a person lets it write in their space by giving that key a capability.
---
An [agent](../agent.md) has its own keys, and it signs what it publishes with them. So a [comment](../protocol/comments.md) that an agent writes shows the agent as its author, not the person who owns the agent. This page explains the agent's **signing identities**: what they are, where the keys are kept, which one the agent uses by default, and how a person lets the agent publish in their space. It also covers how the [app environment](../software/app-environment.md) stores secrets.

# The agent's own keys

A signing identity is an Ed25519 key that belongs to the agent. Each one is a Seed [account](../protocol/identity.md) with a published [profile](../profile.md).

The app environment creates the key (`CreateSigningIdentity`). It does three things:

1. It makes a new key on the server.
2. It publishes a profile with the name you gave.
3. It stores the key encrypted.

In the app, **New Account** does this. It also creates a [home document](../protocol/spaces.md) that says the account belongs to an agent.

The agent signs as one of its own identities. Its work is attributed to the agent, never to the person who owns it.

Hypermedia content must be signed on the device that holds the key. This is why Seed has no MCP server of its own; see [Why there is no Seed MCP server](../build/agents.md). An app environment does sign content, and that follows the same rule, because the keys it signs with are the agent's own. Your account key stays on your device. <!-- id:Q7N_J4rc -->

Agent keys are less safe than your personal key, because the app environment holds them. That is one reason to give an agent its own key and not your personal one. `ImportSigningIdentity`, the Import key button in the accounts dialog, sends the secret part of an existing `.hmkey.json` [key](../build/keys.md) to the server. So only import a key that was made for the agent. If you do not want a hosted server to hold your agent keys, [host the app environment yourself](../operate/self-hosted-app-environment.md). <!-- id:LrPb8BxH -->

# Granted identities and the primary account

Signing identities belong to the owner's account on the server. An agent may use the ones its owner granted to it. The agent's definition lists them as `signingKeys`.

One of them is the agent's **primary signing account**, named by `signingKey`. It is the account the agent *is*:

- the agent signs as it, unless it is asked to sign as another;
- mentions of it reach the agent, through the mention [trigger](../trigger.md) the server creates for it;
- it holds the agent's write access in the space of its [document](./mounting.md).

When `signingKey` names a key that is no longer granted, the first granted key is the primary.

Each turn, the model gets the granted identities as a list of profile names and public keys, primary first. So when a user says a name, the model knows which key to sign with. See [what an agent is told](./prompt.md).

An agent with no signing identity cannot publish. The built-in [Assistant](./assistant.md) has none.

Publishing also needs the `publish` [grant](./grants.md). The agent does not use its identities until that grant is on.

# Writing in a person's space

An agent's key can always publish in its own account's space. To publish inside a person's space, the agent needs that person's permission. The person gives the agent's identity a `WRITER` or `AGENT` [capability](../protocol/permissions.md). Any collaborator gets the same kind of permission, and the [permissions](../protocol/permissions.md) page explains the roles.

For an agent that has a [document](../protocol/documents.md), the app does this when the agent is created; see [what the agent can write](./mounting.md). [Using Seed from your own agent](../build/agents.md) shows how to do it from the [CLI](../build/cli.md).

The server refuses a write to a space where the signer has no access. It refuses before anything is published, with a message that names the missing capability.

# Managing identities

In the app, an agent's **Settings > Authorship identities** page lists the identities the agent may sign as. **Grant** adds an identity the server already holds, and **New Account** makes a new one. The **Server accounts** dialog, opened from Settings, lists every identity the account keeps on that server.

Only the owner can manage identities, and the server enforces it. A collaborator sees only the identities granted to the shared agent, and a writer cannot change the granted set. See [sharing an agent](./sharing.md).

The actions:

- `UpdateSigningIdentity` publishes the account's profile again with a new name or icon.
- `DeleteSigningIdentity` deletes the encrypted key from the server. Profiles that were already published stay on the network, because a published [blob](../protocol/blobs.md) cannot be removed.
- `ListSigningIdentities` returns only metadata, never a key.

No general action deletes a secret. A provider's API key is removed with its provider, and a signing key with `DeleteSigningIdentity`. The shapes are in the [signed API](../build/signed-api.md).

# How secrets are stored

Signing keys, provider API keys, sign-in credentials and MCP header values are all **secrets** of an account.

- A secret is written once (`SetSecret` and the actions above) and never read back. Every response carries only metadata.
- An account never sees another account's secrets.
- The server encrypts secrets with AES-256-GCM under a 32-byte key that it generates, with a fresh 12-byte nonce for every write.
- That key is stored in the same SQLite database as the secrets. This keeps secrets out of the API and the logs. It does not protect against someone who has the whole database.
- There is no key rotation, no secret versioning, and no storage of the key in an operating-system keychain or a key management service.
- The shared client refuses to send a secret to a remote server over plain HTTP. A remote app environment must use HTTPS.
- The server never writes secrets, decrypted keys, signed request bodies, full prompts or the full content of a [session](./session.md) to its logs.

See the [security model](./security.md).

# See also

- [Seed Agents](../agent.md)
- [Agents are documents](./mounting.md)
- [Sharing an agent](./sharing.md)
- [Security model](./security.md)
- [Identity](../protocol/identity.md)
- [Permissions](../protocol/permissions.md)
- [Keys](../build/keys.md)
- [MCP servers](./mcp.md)
