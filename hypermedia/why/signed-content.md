---
name: Signed content
summary: Why authors sign their own documents and comments on their own devices, what that gives readers, and why the team chose not to build on ActivityPub.
---
When you read a page on the web, you trust the server. It could have changed the text or be serving an old copy, and nothing in the page proves who wrote it. Federated systems such as Mastodon spread that trust from one big server to many small ones, but you still trust a server. <!-- id:24w0HWwM -->

Hypermedia puts the trust in the author. Every [document](../protocol/documents.md) change, [comment](../protocol/comments.md), permission grant and [profile](../profile.md) is a piece of data signed by the author's own key, on the author's own device. Anyone who receives it can verify it, whoever delivered it. <!-- id:Qk-puvV5 -->

# Identity is a key <!-- id:cKyoL-B9 -->

An [account](../protocol/identity.md) in Hypermedia is a key pair. The public key is the account's identifier and appears in every address that belongs to it. The private key never leaves the author's device, or the encrypted vault the author chose to keep it in. There is no registration server: creating an account means generating a key. <!-- id:9MDFVdwL -->

You get a stable identity that no company can suspend, and you can stay pseudonymous if you want. Losing the key is serious. Seed stores it in the operating system keychain or in a zero-knowledge [vault](../apps/vault.md), and a 12-word recovery phrase rebuilds it. [Identity](../protocol/identity.md) has the details, including how browser sessions and devices act for an account without holding its key. <!-- id:NPnvm3sZ -->

# What a signature proves <!-- id:TaEL6mw2 -->

Each signed [blob](../blob.md) carries the signer's public key and a signature over the canonical encoding of everything else in it. A reader checks three things: the encoding is well-formed, the signature matches the signer, and the signer is allowed to do what the blob says. The third check is where [permissions](../protocol/permissions.md) come in. A change to a document is accepted only if the signer owns the document's space or holds a [capability](../capability.md) from the owner. <!-- id:lyERiFJI -->

Signatures cover the content itself, so a [gateway](../protocol/sites.md) or a [peer](../protocol/network.md) that relays the data cannot alter it without being caught. It cannot sign for you, and it cannot delete the data for good if someone else has a copy. A gateway can still refuse to serve you, serve a stale version, or log who asks for what. Running your own node removes those risks, and any Seed site is a full node. <!-- id:e7tgIqWq -->

# Why not ActivityPub <!-- id:yRK5x6fC -->

People ask why the team did not build on ActivityPub. ActivityPub brought federation to the mainstream, and that matters. It solves a different problem. <!-- id:R7yLisXh -->
  - **Content integrity.** In ActivityPub, content lives on servers and can be changed at any time. Nothing built in lets you verify that what you read is what the author wrote. You trust the server. <!-- id:kutDapMx -->
  - **Permanent links.** When a server shuts down, every link to content on it breaks. The content may survive somewhere as a backup, but the addresses stop working, because each link names a server. <!-- id:vdAIxtfg -->
  - **Author signatures.** ActivityPub signs the messages servers send each other. It does not sign the content. You trust the server operator instead of the author. <!-- id:CjTGGGUV -->

These were reasonable choices for a standard meant to federate social interactions and be easy to adopt. Content that stays verifiable and linkable while servers come and go needs different foundations: content signed by authors, addressed by hash, and replicated by anyone who cares about it. That approach has costs too. It is harder to build and harder to explain, and the tooling is younger. The team thinks there is room for both. <!-- id:aLyUbHBV -->

# What ships today <!-- id:LXQMv3tp -->

- Ed25519 keys as account identity, signatures on every blob, and verification in the [daemon](../apps/daemon.md) before anything is indexed. See [Integrity](../protocol/integrity.md) for exactly what is verified end to end and what is still trusted. <!-- id:i2s04KBT -->
- Owner-issued capabilities for writers and for agent keys that act for an account. See [Permissions](../protocol/permissions.md). <!-- id:3lKbgyHw -->
- Signing in the browser with a session key delegated from the vault, so web comments carry a real signature. See [Sign in with Seed](../build/sign-in.md). <!-- id:d2uvRy87 -->

# What is still direction <!-- id:f9MMJ_Am -->

Timestamps are declared by the signer and nothing proves them. Capabilities cannot yet be revoked or given an expiry. Anyone can comment on anything, and moderation is each node's choice. The "web of trust" that would rank strangers by your contacts' endorsements is a stated goal with no code behind it. Today a [contact](../contact.md) is a public statement that you know an account by a name, and it grants nothing. [Where this is going](../protocol/roadmap.md) tracks the redesign. <!-- id:lgqFnvqA -->

# See also <!-- id:YNcyL_MN -->

- [Identity](../protocol/identity.md) <!-- id:k-bCRLlV -->
- [Integrity](../protocol/integrity.md) <!-- id:efnN4Ej9 -->
- [Permissions](../protocol/permissions.md) <!-- id:2Zh2gdoR -->
- [Signed blobs](../protocol/blobs.md) <!-- id:7NC6yAZY -->
- [The end of broken links](./broken-links.md) <!-- id:YFUBn2QX -->
- [Open editing](./open-editing.md) <!-- id:jerB2eb8 -->
