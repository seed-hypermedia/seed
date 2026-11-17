---
name: Network
summary: This page explains how Seed nodes find each other, work out which signed blobs one of them is missing, and download only those.
---
Every Seed node is a **peer** on one shared network. When you open a [document](./documents.md) you do not have, your node asks the peers most likely to hold it. The two nodes compare what they hold, to find exactly which [blobs](./blobs.md) your node lacks. Your node downloads only those. This is called **sync**. No node sends anything to everyone. Sync follows the [sites](./sites.md), [contacts](./contacts.md) and subscriptions you care about. <!-- id:s6MwlPMV -->

This page describes the network layer of the [Seed daemon](../software/daemon.md). It is the deepest layer of the [Hypermedia protocol](../protocol.md). Most builders never touch it. They read and write through a site's [Seed API](../build/web-api.md). Read this page to learn why a document appears on another machine, and why that sometimes takes a while. To run a node that other nodes can reach, read the [daemon network reference](../operate/daemon-network.md). It has the ports, flags, constants and debug pages. <!-- id:rrHf8uOe -->

# Peers and the device key <!-- id:fW5msSPp -->

Each running daemon is one libp2p peer. On the network it is known by its **device key**: an [Ed25519](https://en.wikipedia.org/wiki/EdDSA#Ed25519) key pair. The daemon makes the key the first time it starts and stores it in its data directory. The peer id comes from that key. It is the `12D3Koo…` string you see in the network dialog of the [Seed app](../software/desktop.md). <!-- id:UY6Ypwol -->

The device key is separate from any account key. Account keys ([identity](./identity.md)) sign content. The device key only secures connections. One person can run several devices. A site's server is a device that holds no account key at all. Sometimes a connection must prove which account is behind it. Then the peer signs a short-lived [capability](./permissions.md) with the account key (see [Privacy](./privacy.md)). The networking API shows an `account_id` field on a peer, and it is always empty. <!-- id:hZ_imBXf -->

# Protocol id and versions <!-- id:bZHlAHsP -->

Every Seed peer announces the libp2p protocol id `/hypermedia/0.9.2`. A daemon started with a testnet name announces `/hypermedia/0.9.2-<name>`. Only that suffix keeps a testnet apart. The bootstrap list is the same everywhere. A daemon rejects a remote peer whose version string does not match exactly, as an incompatible protocol version. So peers on different protocol versions do not sync with each other. The same id names the stream on which the daemon serves its peer-to-peer gRPC services. <!-- id:YLHlb4Ut -->

# Transports and reachability

Peers connect over the default go-libp2p transports: TCP, QUIC, WebSocket, WebTransport and WebRTC-direct. Most desktop nodes sit behind a home or office router (NAT), so other nodes cannot dial them directly. They use hole punching and a circuit relay to be reachable. A site server is always directly reachable and never uses a relay. The [daemon network reference](../operate/daemon-network.md) has the listen addresses, the relay servers and the flags that control them.

# Finding peers <!-- id:626I71gy -->

Seed does not run a distributed hash table (DHT). No node announces "I have this document" to a global index. A node cannot find a document by its hash alone. <!-- id:C_91MIol -->

**Discovery** is the search for peers that hold what you want. It uses these sources: <!-- id:ypoIObe0 -->
  - **Bootstrap gateways.** Every daemon has a built-in list of Seed servers. It dials them when it starts and stays connected: production `hyper.media`, `dev.hyper.media`, `staging.hyper.media` and one community node. These are ordinary site daemons that hold nearly everything public. Every discovery asks them first. The daemon also dials the public kubo bootstrap peers from IPFS. They do not speak the Hypermedia protocol, so discovery leaves them out. <!-- id:MBKb82xz -->
  - **Peer exchange.** After the daemon identifies a bootstrap peer, it asks that peer for its recent peer list (rows updated within 30 days). It stores them in its own `peers` table. Every 60 seconds the daemon checks that about 20 Hypermedia peers outside the bootstrap list are connected, and dials stored peers when it has fewer. Dead peers drop out over time, because nothing refreshes their rows. <!-- id:AHKK0Ycl -->
  - **Site peer resolution.** A [space](./spaces.md) can name a `siteUrl` in the [metadata](../metadata.md) of its home document. Then the daemon fetches `https://<site>/hm/api/config` to learn the site server's peer id and addresses. It treats that server as the **authority** for the space: the first peer it asks about that space. The daemon caches the answer for five minutes. It also keeps it in the `domains` table, to use when the fetch fails. <!-- id:1EGqCshv -->
  - **Explicit connections.** The `Networking.Connect` RPC takes multiaddrs, and the Seed app accepts a peer address, an `hm://connect/…` link or any site URL in its network dialog. <!-- id:JDqif9sd -->
  - **DNS names inside multiaddrs.** DNS appears only in `/dns4/hyper.media/…` addresses and in the HTTPS hostnames of site URLs. There is no DNSLink or TXT-record lookup. <!-- id:utfMssWU -->

So you can find a public document only because some [gateway](./sites.md) or site server has it. The network as a whole keeps no index. You can find a [private](./privacy.md) document only from its site server, or from a device that proved it is an authorized account. <!-- id:VBWkFsW- -->

# What sync exchanges <!-- id:oRGp7Z3y -->

A sync always asks about a **scope**. It never asks for "everything peer X has". A scope is one [resource](../glossary.md) address such as `hm://ACC/notes/foo`. It can include the resource's direct children (`depth one`) or everything under it (`recursive`). It can also be limited to some blob types. Both sides work out the same set of blobs for a scope, each from its own index: <!-- id:v01a_crK -->
  1. the [Refs](../ref.md), [capabilities](../capability.md), [comments](./comments.md), [profiles](../profile.md) and [contacts](../contact.md) that belong to the resources in scope; <!-- id:45mCSNnK -->
  2. every [change](../change.md) reachable from those Refs through their heads and dependencies; <!-- id:6igt5Qam -->
  3. the media those blobs link to (files, images, chunks), following every link, but skipping blobs the index set aside because their signer had no right to write; <!-- id:1TFxz3Da -->
  4. inbound contacts naming the space's account, when the scope is a whole space; <!-- id:ObsE4rln -->
  5. capabilities with the AGENT role whose delegate signed anything already in the set, repeated until nothing new appears. <!-- id:aueRH4nV -->

Both peers build the set with the same rules, so they can compare it without listing it. The daemon keeps this set ready for each scope and updates it each time it indexes new blobs. A background check rebuilds a few scopes every 30 seconds and repairs any difference. <!-- id:kyanjcoF -->

# Reconciling with RBSR <!-- id:CCzzBZWN -->

**Range-Based Set Reconciliation** (RBSR) is a way for two peers to find the differences between two large sets. Each peer sorts its items and makes a hash summary of a range of them. The peers compare summaries, so they never send every item id. When the summary of a range differs, the peers split that range and compare the smaller parts. They repeat this until they find the exact items that differ. The cost grows with the number of differences. The total size of the set matters very little. Seed's implementation follows [Aljoscha Meyer's paper](https://arxiv.org/abs/2212.13567) and the Negentropy design. <!-- id:xySd4TLf -->

The result goes one way: the peer that started learns which [CIDs](../cid.md) the other peer has and it lacks. Seed pulls. It never lets a stranger push. The [daemon network reference](../operate/daemon-network.md) has the item order, fingerprint and message limits the daemon uses.

# Fetching with Bitswap <!-- id:ceeB4L1N -->

Once the daemon knows which CIDs it wants, the blobs travel over [Bitswap](https://docs.ipfs.tech/concepts/bitswap/), the IPFS way to exchange data. In Bitswap each peer keeps a list of the pieces of data it wants. Peers swap these lists when they connect, and each serves what it has. Seed opens one Bitswap session per discovery. It fetches in the order a page needs things:

1. signed [DAG-CBOR](../schema/dag-cbor.md) blobs,
2. page media such as icons and covers,
3. inline images,
4. large files.

Large downloads share one slot for the whole daemon, so a large PDF never holds up a page's text. The daemon checks every piece against its CID when it arrives, and indexes it like any other blob. [Files](./files.md) covers the media side. <!-- id:FHknLJFV -->

Bitswap itself does not control access. It accepts a function that runs for every `(peer, CID)` request. Seed uses that function to keep private blobs from peers with no access (see [Privacy](./privacy.md)). <!-- id:8htzlUD2 -->

# Discovery, step by step <!-- id:RyvMaoH1 -->

`DiscoverEntity` is the one call that the Seed app, a site server and subscriptions all use. It takes an [`hm://`](./urls.md) discovery URL: <!-- id:hDOJOgRm -->

<!-- id:hHR-wFxJ -->
| URL <!-- col:L51yKcPv --> | Scope <!-- col:OJHggs38 --> <!-- id:nLYNL14P --> |
| --- | --- |
| `hm://ACC` | the home document, all blob types <!-- id:WRlzhBNQ --> |
| `hm://ACC/path` | one document <!-- id:jWQwHNzS --> |
| `hm://ACC/path/*` | the document and its direct children <!-- id:zoImNPgK --> |
| `hm://ACC/path/**` | the document and every descendant <!-- id:NY8AInJp --> |
| `hm://ACC/:profile`, `hm://ACC/path:profile` | profile, Ref and change blobs only <!-- id:HWAiYWf4 --> |

A discovery run may take up to ten minutes. It goes through three tiers: <!-- id:qLpkpCaQ -->
  1. **Authority.** The space's site server, if its `siteUrl` is known, plus the bootstrap gateways. If the space has a site and you already hold the content, the gateways are dropped. <!-- id:n0zX5Ecz -->
  2. **Connected.** A sample of already-connected Hypermedia peers, up to 20. <!-- id:5PXdiW6i -->
  3. **Cold.** Peers from the stored table that need a dial. <!-- id:gsStG1E2 -->

A later tier runs only if the tier before it did not find everything. The exception is an **exhaustive wave**, a search that asks all tiers. Every recursive scope gets one on a fixed interval, and a user who opens something new can force one. The [daemon network reference](../operate/daemon-network.md) has the intervals, the per-tier limits and the rule for benching peers that fail to dial.

For a recursive scope, a quick first pass fetches only the structure (Refs and changes, depth one, no media). So a directory listing appears before its files. Once the daemon holds the target, the run ends with the outcome `connected`. If nothing resolved, the run ends quietly with no error, and the caller keeps polling. (The code still has a last step named "DHT". It does nothing.) <!-- id:b4tx7iL8 -->

# Hot and cold tasks

The daemon runs every discovery through one scheduler. A **hot task** comes from a client that is looking at something. The Seed app calls `DiscoverEntity` for the document on screen every few seconds, and each call keeps the task alive. A **cold task** is a subscription, which the daemon runs again on a fixed interval. The scheduler always keeps one slot for hot work, so background sync never delays the document on screen. When a scope stops changing, the daemon asks fewer peers about it. The [daemon network reference](../operate/daemon-network.md) has the scheduler's slots, intervals and fan-out rules.

# Subscriptions <!-- id:qdL5oZqn -->

A **subscription** tells the daemon to keep one resource up to date. It is a row `(iri, recursive)` and a lasting cold task for it. `Subscriptions.Subscribe` stores the row, schedules the task and runs one discovery right away. The call waits for that discovery, unless you ask it to run in the background or the daemon already holds the resource. A site server subscribes recursively to every account registered on it. That keeps a whole space up to date on the site. The Seed app subscribes to the spaces you join or follow. No mode copies everything a peer holds. <!-- id:Rre7kjpx -->

# Push <!-- id:N3Jjt-C7 -->

Nodes pull by default. But a publisher should not have to wait until its site asks. `Resources.PushResourcesToPeer` takes a peer's addresses and a list of resources. It works out the related material: changes, Refs, the authors' root Refs and profiles, link targets, [citations](./links-and-citations.md), comment links, and media. Then it calls the peer's `AnnounceBlobs` RPC with the CIDs. The daemon that receives the call checks which CIDs it lacks, fetches them over Bitswap from the sender, and indexes them. The caller receives progress as it happens. <!-- id:1gzJjA-e -->

The Seed app pushes when you publish a document, when you register a site, and when you push a document to a site explicitly. It pushes to the space's site server, and to the site servers of the documents you linked. So citations and backlinks appear on the self-hosted sites of the people you cite. A push includes private blobs only when the target is the space's own site server. A node accepts any announcement, but it can fetch only what the sender is willing to serve it. Push only makes sync faster. You publish when you sign: from that moment your blobs exist in your local daemon, even if the push announces nothing. <!-- id:tzqHChlt -->

# Sync and gossip <!-- id:1C6REGld -->

Seed's sync is built around [identity](./identity.md), trust and what matters to you. So it works very differently from [gossip protocols](https://en.wikipedia.org/wiki/Gossip_protocol), although both run in peer-to-peer networks. <!-- id:JTmIApFc -->

**Seed sync is narrow.** A gossip protocol spreads each message to many peers, and each of those passes it on to more, partly at random. It does not know who should receive a message, only that the message should spread. Spam spreads the same way. Seed sync copies a resource only to peers that have a clear tie of trust or interest to it. It sends nothing to everyone. <!-- id:Np6hvCgY -->

**Identity decides where content goes.** The possible receivers are known in advance: verified owners of sites, trusted [contacts](./contacts.md) (and so their peers, including keys that act for them), and explicit subscriptions. Users control this set, and it has limits. A node should never push content to peers that did not ask or to random peers. <!-- id:ZRCc3DMM -->

**Seed does not spread like an epidemic.** Gossip keeps spreading a message until it has very likely reached everyone. Seed does not forward a blob again and again, and does not deliver by chance. Sync delivers to chosen targets. <!-- id:cjYOcj2Z -->

Discovery does contact up to 20 peers per tier. That is a _pull_: it asks "do you have this?" about one resource. It never pushes your content to strangers. <!-- id:M5oOcjbz -->

# Private content over the network <!-- id:fvIIPM6D -->

A node serves public blobs to anyone who asks. It serves a [private](./privacy.md) blob ([visibility](../visibility.md)) only to a peer that proved it is an authorized account, to the space's site server, or to the target of a push. <!-- id:iS2tjilm -->

The same rule applies when peers compare sets. Before it answers, a peer reduces its scope set to what the caller may see, and leaves private items out of its summaries. So a peer with no access never learns that a private blob exists. [Privacy](./privacy.md) has the full rules for peers and for HTTP. <!-- id:acPTtPhz -->

# Worked example: a document you do not have <!-- id:8gc6eN0x -->

You open `hm://ACC/notes/foo` in the Seed app and nothing about `ACC` is on your machine yet. <!-- id:p3LkUrxf -->
  1. The app calls `DiscoverEntity` with that URL and keeps calling it every few seconds while the view is open. The daemon creates a hot task. Because you just opened the document, it also plans one exhaustive wave. <!-- id:l0dKo1tH -->
  2. The scheduler starts the task at once, in the slot it keeps for hot work. <!-- id:rI9GIrsT -->
  3. The daemon looks for `ACC`'s `siteUrl`. It knows nothing about `ACC`, so it has no site server to ask. The wave is a full search: every bootstrap gateway plus a sample of 20 peers. <!-- id:aW6eMg6v -->
  4. The daemon builds its local set for the scope. The set is empty. <!-- id:foNjEbdE -->
  5. Tier `authority` runs first. For each gateway the daemon opens (or reuses) a gRPC stream over libp2p, asks which spaces it may see (public only, because it did not prove an account), and runs `ReconcileBlobs` rounds for the filter `hm://ACC/notes/foo` until the ranges agree. <!-- id:Ow6Xre8P -->
  6. The wanted CIDs go to Bitswap: DAG-CBOR blobs first, then icons and inline images, then bulk files if the media slot is free. The pieces of data pass through one writer into the index, which also updates the stored scope sets. <!-- id:K0CNVaEB -->
  7. The authority tier found everything. So the daemon skips the connected and cold tiers, unless this is the exhaustive wave. <!-- id:OcxqwPsy -->
  8. `GetResource` now resolves. The task completes with the version. It runs again every ten seconds while you keep looking. <!-- id:hdCaY0qt -->
  9. Later, `ACC`'s home document (and its `siteUrl`) has arrived and you have subscribed. A run on a scope that has stopped changing asks only the site server. It compares sets once every ten seconds while you view the document, and once a minute when you do not. It also runs one full search every ten minutes. <!-- id:vgnaIEH- -->

If step 5 finds nothing anywhere, the run ends with an empty version and no error. The page keeps showing "looking for this document". The task tries again with the same peers every ten seconds. <!-- id:ePa3MdMI -->

# Working with the network <!-- id:56Wwc-GS -->

Only the daemon speaks libp2p. The [Seed CLI](../build/cli.md), the [SDK](../build/sdk.md) and [Seed Agents](../agent.md) run no peer. They read and publish through a site's [Seed API](../build/web-api.md), and that site's daemon does the networking.
  - **In the Seed app.** The network dialog lists connected peers. "Add connection" accepts a multiaddr list, an `hm://connect/…` or `https://…/hm/connect#…` link from another Seed app, or any site URL.
  - **Through a site.** `GET /api/DiscoveryStatus?uid=…&path=…` asks the site's daemon to look for a document it does not hold and reports `pending`, `found` or `failed`. `POST /hm/api/discover` waits until the daemon has the document. `GET /hm/api/config` describes the site's peer. The [Seed API](../build/web-api.md) page has the request and response shapes. The SDK calls the same routes with `client.request('DiscoveryStatus', …)`.
  - **Against a daemon.** The [gRPC](../build/grpc.md) surface has the calls for peers, subscriptions, discovery and push:

    - `Networking.GetPeerInfo`, `Networking.ListPeers` (no addresses, by design) and `Networking.Connect(addrs)`. <!-- id:7voiOes4 -->
    - `Subscriptions.Subscribe/Unsubscribe/ListSubscriptions`. <!-- id:kvpyNysS -->
    - `Entities.DiscoverEntity(id, version?)`. <!-- id:9mUDFYsX -->
    - `Resources.PushResourcesToPeer(addrs, resources)`. Its `recursive` field has no effect. <!-- id:0Shqcv40 -->
    - `Daemon.GetInfo` for your own peer id and protocol id. <!-- id:bgeUY0Z- -->

```sh <!-- id:FZrOsxuq -->
grpcurl -plaintext localhost:56002 com.seed.networking.v1alpha.Networking/ListPeers
grpcurl -plaintext -d '{"id":"hm://ACC/notes/foo"}' localhost:56002 \
  com.seed.entities.v1alpha.Entities/DiscoverEntity
```

# See also <!-- id:69ZiysmY -->

- [Sites](./sites.md): what a site server is, and how registration makes it the authority for a space. <!-- id:_4OPjj29 -->
- [Files](./files.md): how media travels over the same Bitswap sessions and the `/ipfs` gateway. <!-- id:XrRcRSJk -->
- [Privacy](./privacy.md) and [Integrity](./integrity.md): what a peer may see and what is verified. <!-- id:P2cn3zac -->
- [Identity](./identity.md): account keys versus the device key. <!-- id:GN1r8jDV -->
- [Daemon network reference](../operate/daemon-network.md): ports, flags, constants, transports, relays, the scheduler and debug pages.
- [Self-hosting](../operate/self-hosting.md): the compose file, ports and registration link for running your own node. <!-- id:NTPVJGG5 -->
- [Blobs](./blobs.md): the data that moves, with the type pages [blob](../blob.md), [change](../change.md) and [ref](../ref.md). <!-- id:RXbiH6dR -->
