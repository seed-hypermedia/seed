---
name: Prior Art for Content Permissions
summary: What UCAN, Tahoe-LAFS, macaroons, Biscuit, SSB, and Matrix teach us about permissions over content-addressed data — and what to steal from each.
displayAuthor: Eric Vicenti
---
Every design decision in the [permissions proposal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/v1-proposal) has been made before by someone, usually the hard way. This doc surveys the systems most relevant to permissions over content-addressed storage, and extracts the specific lessons that apply to Hypermedia. <!-- id:bDVf9FxX -->

# UCAN (User-Controlled Authorization Networks) <!-- id:41_-6X3Q -->
The closest prior art to our read-capability idea. UCANs are signed, chained delegation tokens built for IPFS-adjacent systems (originally Fission, now used in web3.storage circles): issuer, audience, capabilities (resource + ability), expiry, proof chain back to the resource owner. <!-- id:71qHtPis -->

**What they got right:** <!-- id:rtRKyFFC -->
  - Delegation chains verified offline, no central authority. Each link narrows or preserves authority — never widens it (attenuation). <!-- id:FrN_nB9E -->
  - Expiry is mandatory. Short-lived tokens sidestep most revocation pain. <!-- id:90U8sxMh -->
  - Capabilities name a _resource and ability_ ("read `hm://x/docs`"), not an object reference — which matches our document-ID-scoped grants. <!-- id:n1ouhX7a -->

**What they struggled with:** <!-- id:nZXR4yj3 -->
  - Revocation. UCAN ended up with a separate revocation spec that amounts to "publish a signed revocation and hope verifiers check it" — the exact tar pit described in [rabbit holes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/rabbit-holes). <!-- id:M6YReW1g -->
  - Token size and chain-fetching: verifying requires possession of the whole proof chain. Plan for caps to be blobs in the same store, synced like everything else, so the chain is fetchable by CID. <!-- id:L8hH-xX_ -->

**Steal:** attenuation-only delegation, mandatory expiry, resource-path scoping. Skip: inventing a new token encoding — our caps should just be IPLD blobs like every other signed statement in the system. <!-- id:i2UWubnI -->

# Tahoe-LAFS <!-- id:NNhJhFNu -->
The most principled answer ever given to "private data on untrusted storage": a read capability _is_ the decryption key plus the location. Servers store ciphertext and cannot read it; possession of the cap is necessary AND sufficient. Write caps derive read caps derive verify caps in a clean lattice. <!-- id:M1hZOvjF -->

**The lesson that matters most:** Tahoe shows where the ceiling is. If we enforce permissions only at the serving layer (ACL-on-serve), every replica must be honest. Tahoe needs no honest servers at all. The price: no server-side search, no dedup across differently-keyed content, no incremental sharing without re-encryption, and revocation means re-encrypting under a new key. Tahoe is why the [synthesis](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/grants) recommends ACL-on-serve _now_ with a cap format that can carry a wrapped key _later_ — the upgrade path to Tahoe-style privacy without paying its costs on day one. <!-- id:YGZRoG4e -->

# Macaroons & Biscuit <!-- id:rZq6k73J -->
Bearer tokens with attenuation: anyone holding a macaroon can add caveats ("only path /docs", "only before Friday") and pass it on, but never remove them. Biscuit (Datalog-based) is the modern successor. <!-- id:zzOfo8NL -->

**Steal:** the _bearer_ mode. A read cap granted to a bearer secret — no grantee key required — is exactly the "anyone with the link can view" feature users actually expect from Google Docs. Macaroons show it composes with attenuation: a share link that expires, or is scoped to one document subtree, falls out naturally. Also steal Biscuit's insight that authorization logic should be _data_ (facts + rules) rather than code — which is literally what `blob_visibility_rules` already is: a Datalog-ish rule table in SQLite. <!-- id:hLZHpAmU -->

# Secure Scuttlebutt (private-groups) & Matrix <!-- id:NzWpEpdY -->
Both are replicated-log systems that retrofitted privacy, and both landed on the same conclusion: **membership change is the hard problem, not encryption.** <!-- id:fx0mI3IH -->
  - SSB private groups encrypt to a group key; adding a member is easy (send them the key), removing one means a new key ("key rotation by exclusion") and the removed member keeps everything they ever had. <!-- id:Quxncrkb -->
  - Matrix's state-resolution bugs were overwhelmingly permission bugs: out-of-order membership events letting banned users act, "state resets" reviving old permissions. Their fix was to make authorization events a first-class part of the DAG with explicit ordering rules — permissions decisions must reference _which_ auth state they were evaluated under. <!-- id:LCTrUvAA -->

**Steal:** Matrix's lesson maps directly onto our timestamp problem — a grant or revocation must be ordered by position in the signed DAG (epoch/generation), never by wall-clock claims. SSB's lesson: design member-removal semantics honestly ("removal stops future access; past access is retained") before anyone builds a UI that implies otherwise. <!-- id:DWN9DlTv -->

# Object capabilities (E, Cap'n Proto) <!-- id:KzcrGPDC -->
The purist tradition: a capability is an unforgeable reference; if you can name it, you can use it; there is no ambient authority. Two ideas transfer: <!-- id:x3Xu7wxb -->
  - **No ambient authority** is the correct default posture for link propagation: reading blob A lets you read what A's _owner_ bundled into A — never what A merely mentions. A CID mention is a name, not a grant. <!-- id:JyOXbuS2 -->
  - **Confused-deputy resistance**: any endpoint that fetches on behalf of a caller (embeds, queries, the dagjson handler) must evaluate access as the _caller_, not as the server. The server's own god-mode access must never leak through a query surface. <!-- id:pI5kmPzj -->

# What no prior system gives us <!-- id:S1ft8yH0 -->
None of these systems had our exact shape: a _publication-first_ network where most content wants to be maximally public and CDN-cacheable, with privacy as the exception. Tahoe and SSB assume private-by-default; UCAN assumes API-access-control. Our design gets to exploit the asymmetry: keep the public path exactly as cheap as it is today, and spend all complexity budget on the private path only. That asymmetry — public content costs nothing extra, private content pays for what it uses — is the design invariant to protect through every decision in the [synthesis](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/grants). <!-- id:1tJzwcLk -->