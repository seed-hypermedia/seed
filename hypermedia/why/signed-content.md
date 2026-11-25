---
name: Signed content
summary: Authors sign their own documents and comments on their own devices, so a reader can check who wrote what without trusting a server.
---
When you read a page on the web, you trust the server. The server could have changed the text, or it could be sending an old copy. Nothing in the page proves who wrote it. Federated systems such as Mastodon spread that trust from one big server to many small ones. You still trust a server. <!-- id:24w0HWwM -->

Hypermedia puts the trust in the author. Every [document](../protocol/documents.md) change, [comment](../protocol/comments.md), permission grant and [profile](../profile.md) is a piece of data that the author signs with their own key, on their own device. Anyone who receives it can verify it, whoever delivered it. <!-- id:Qk-puvV5 -->

# Identity is a key <!-- id:cKyoL-B9 -->

An [account](../protocol/identity.md) in Hypermedia is a key pair: a public key and a private key. The public key is the name of the account, and it appears in every address that belongs to it. The private key stays on the author's device, or in the encrypted vault the author chose. There is no server to register with. Making an account means making a key. <!-- id:9MDFVdwL -->

You get an identity that no company can suspend, and you do not have to give your real name. Losing the key is serious. Seed stores it in the keychain of your operating system or in a [vault](../software/vault.md), which is a server that holds the key encrypted and cannot read it. A recovery phrase rebuilds the key. The [Seed app](../software/desktop.md) makes a phrase of 12 words. [Identity](../protocol/identity.md) has the details, including how a browser or a device can act for an account without holding its key. <!-- id:NPnvm3sZ -->

# What a signature proves <!-- id:TaEL6mw2 -->

Each signed [blob](../protocol/blobs.md) carries the signer's public key and a signature over everything else in it. The signature covers one fixed way of writing the data as bytes, called the [canonical encoding](../schema/canonical-encoding.md). A reader checks three things: <!-- id:lyERiFJI -->

- The encoding is well-formed.
- The signature matches the signer.
- The signer is allowed to do what the blob says.

The third check is where [permissions](../protocol/permissions.md) come in. A new version of a document shows up at its address only if the signer owns the [space](../protocol/spaces.md) or holds a [capability](../capability.md) from the owner.

Signatures cover the content itself. So a [site](../protocol/sites.md) or a [peer](../protocol/network.md) that passes the data on cannot change it without being caught. It cannot sign for you. It cannot delete the data for good if someone else has a copy. A site can still refuse to serve you, serve an old version, or log who asks for what. You avoid those risks when you run your own node, and any Seed site is a full node. <!-- id:e7tgIqWq -->

# Why not ActivityPub <!-- id:yRK5x6fC -->

People often ask why ActivityPub is not the base of Hypermedia. ActivityPub made federation popular, and that matters. It solves a different problem. <!-- id:R7yLisXh -->
  - **Content integrity.** In ActivityPub, content lives on servers, and a server can change it at any time. You cannot verify that what you read is what the author wrote. You trust the server. <!-- id:kutDapMx -->
  - **Permanent links.** When a server shuts down, every link to content on it breaks. A backup of the content may survive somewhere, but the addresses stop working, because each link names a server. <!-- id:vdAIxtfg -->
  - **Author signatures.** ActivityPub signs the messages that servers send each other. It does not sign the content. You trust the person who runs the server, not the author. <!-- id:CjTGGGUV -->

These were reasonable choices for a standard that connects social servers and is easy to adopt. Hypermedia wants content that stays verifiable and linkable while servers come and go. That needs a different base: authors sign the content, a hash names it, and anyone who cares keeps a copy. This approach has costs too. It is harder to build and harder to explain. There is room for both. <!-- id:aLyUbHBV -->

# Limits <!-- id:f9MMJ_Am -->

- The signer declares the timestamp, and nothing proves it.
- A capability cannot be taken back, and it does not expire.
- Anyone can comment on anything, and there is no moderation.
- There is no web of trust that ranks strangers by what your contacts say about them. A [contact](../protocol/contacts.md) is a public statement that you know an account by a name. It grants nothing.

[Integrity](../protocol/integrity.md) lists exactly what a reader can verify and what a reader must trust.

# See also <!-- id:YNcyL_MN -->

- [Identity](../protocol/identity.md) <!-- id:k-bCRLlV -->
- [Integrity](../protocol/integrity.md) <!-- id:efnN4Ej9 -->
- [Permissions](../protocol/permissions.md) <!-- id:2Zh2gdoR -->
- [Signed blobs](../protocol/blobs.md) <!-- id:7NC6yAZY -->
- [The end of broken links](./broken-links.md) <!-- id:YFUBn2QX -->
- [Open editing](./open-editing.md) <!-- id:jerB2eb8 -->
