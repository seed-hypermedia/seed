---
name: Signed content, not server trust
summary: Why authors sign their own documents and comments on their own devices, what that buys you, and why the team chose not to build on ActivityPub.
---
When you read a page on the web, you are trusting the server. It could have changed the text, it could be serving an old copy, and nothing in the page proves who wrote it. Federated systems such as Mastodon move that trust from one big server to many small ones, but it is still the server you trust.

Hypermedia moves the trust to the author. Every document change, comment, permission grant and profile is a piece of data signed by the author's own key, on the author's own device. Anyone who receives it can verify it, whoever delivered it.

# Identity is a key

An [account](../glossary.md) in Hypermedia is a key pair. The public key is the account's identifier and appears in every address that belongs to it. The private key never leaves the author's device, or the encrypted vault the author chose to keep it in. There is no registration server: creating an account is generating a key.

This gives you a consistent identity over time that no company can suspend, and it lets you stay pseudonymous if you want. It also means that losing the key is serious. Seed stores it in the operating system keychain or in a zero-knowledge [vault](../apps/vault.md), and a 12-word recovery phrase reconstructs it. [Identity](../protocol/identity.md) has the details, including how browser sessions and devices act on an account's behalf without holding its key.

# What a signature proves

Each signed [blob](../blob.md) carries the signer's public key and a signature over the canonical encoding of everything else in it. A reader checks three things: that the encoding is well-formed, that the signature matches the signer, and that the signer is allowed to do what the blob says. The third check is where [permissions](../protocol/permissions.md) come in: a change to a document is accepted only if the signer owns the document's space or holds a [capability](../capability.md) from the owner.

Because signatures cover content and not transport, a gateway or a peer that relays the data cannot alter it without being caught, cannot sign on your behalf, and cannot permanently delete it if someone else has a copy. A gateway can still refuse to serve you, serve a stale version, or log who asks for what. Running your own node removes those risks, and any Seed site is a full node.

# Why not ActivityPub

ActivityPub brought federation to the mainstream, and that matters. People sometimes ask why the team did not build on it. The honest answer is that it solves a different problem.

- **Content integrity.** In ActivityPub, content lives on servers and can be changed at any time. There is no built-in way to verify that what you read is what the author wrote. You trust the server.
- **Permanent links.** When a server shuts down, every link to content on it breaks. The content may survive somewhere as a backup, but the addresses stop working. Links are tied to servers, not to content.
- **Author signatures.** ActivityPub signs messages between servers, not the content itself. You are trusting the server operator, not the author directly.

These were reasonable choices for an easy-to-adopt standard for federating social interactions. If you care about content that stays verifiable and linkable when servers come and go, you need different foundations. Content signed by authors, addressed by hash, and replicated by anyone who cares about it. That approach has costs too: it is harder to build, harder to explain, and the tooling is younger. The team thinks there is room for both.

# What ships today

- Ed25519 keys as account identity, signatures on every blob, verification in the daemon before anything is indexed. See [Integrity](../protocol/integrity.md) for exactly what is verified end to end and what is still trusted.
- Owner-issued capabilities for writers and for agent keys acting on behalf of an account. See [Permissions](../protocol/permissions.md).
- Signing in the browser with a session key delegated from the vault, so web comments carry a real signature. See [Sign in with Seed](../build/sign-in.md).

# What is still direction

Timestamps are self-declared by the signer, not proven. Capabilities cannot yet be revoked or given an expiry. Comments are accepted from anyone on anything, and moderation is a node-side choice. The "web of trust" that would rank strangers by your contacts' endorsements is a stated goal, not code: today a [contact](../contact.md) is a public statement that you know an account by a name, and it grants nothing. [Where this is going](../protocol/roadmap.md) tracks the redesign.

# See also

- [Identity](../protocol/identity.md), [Integrity](../protocol/integrity.md), [Permissions](../protocol/permissions.md)
- [The end of broken links](./broken-links.md)
