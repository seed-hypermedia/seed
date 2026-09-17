---
name: Where this is going
summary: The decided but unbuilt direction of the Hypermedia protocol as of September 2026, from the node and resource redesign to permissions, private documents, sync and schemas, marked clearly as direction rather than specification.
---
The concept pages on this site describe what the Seed daemon does today. This page collects the direction the team has agreed on but not yet shipped, so that no concept page has to describe an unbuilt design as current. Everything here is design direction as of September 2026, dated to the team discussion it comes from. It will change, and pieces of it may be dropped. When something lands, its concept page is updated and the item leaves this page. <!-- id:Wjm8talF -->

The decisions were made in the team's tech syncs and design meetings, recorded on the team site, and the wider process is deliberately slow: a change to permanent data goes through a written proposal, argumentation, and a decision "by technical extenuation", with a preference for solving problems at the application layer whenever the permanent data can stay as it is. <!-- id:v-XBgRBp -->

# The node and resource redesign (HM26) <!-- id:EbZXct8V -->

**Where it comes from.** August and September 2026 tech syncs. <!-- id:4D-PNd-r -->

**The problem.** Today a document's identity, its position in the hierarchy, and its permissions are all carried by its path. A child's [Ref](../ref.md) repeats its parent's path names, so renaming a parent means republishing every descendant with new Refs and redirects, which the team called unreliable. Paths conflate identity, hierarchy and permission. <!-- id:vEWfZ4_t -->

**The direction.** Every mutable thing becomes a node with a stable, non-forgeable node ID. A node blob carries a target (changes, a tombstone or a redirect), a relative name, and a parent, which is a space plus a node ID. Nodes have exactly one parent; there are no hard links, because a node is both a directory and a file. Creating a name in a parent that points at a node requires authority over both. Human-readable "pretty" paths become the space owner's liability and are served by a link-shortening and redirect layer outside the permanent data, which is also how existing `hm://` URLs keep resolving. Links are written with full context, node ID plus path, and resolved through a fallback order. Nodes may be unnamed, which is how private documents without human paths will work. Comments become nodes without a prior ID; an edit references the original node ID, so comments, children and capabilities move as a unit when their target moves. <!-- id:b3VkjHh2 -->

**What it replaces.** The current path-keyed Ref model, called HM24 internally. Legacy node IDs cannot be reused in the new format, to prevent forgery; a migration idea is to hash the old path as the node ID. Sub-document capabilities are expected to be discarded in the migration, everything else migrated. The team's phrase: the authority graph is critical, the placement graph is for naming and addressing, and moves must preserve authority. <!-- id:VYnZrfM1 -->

**Vocabulary.** "Resource" stays the umbrella term for mutable things built from blobs, matching the RPC. Capabilities are treated as a special category of resource. Whether comments are resources at all is still open; one view is that they are closer to triples than to locations. <!-- id:HhBw4dy4 -->

**Affected pages.** [Documents](./documents.md), [URLs](./urls.md), [Comments](./comments.md), [Ref](../ref.md). <!-- id:fhHgoGgG -->

# Home documents become profiles <!-- id:4QzHEyF6 -->

**Where it comes from.** 2026-05-14 tech sync and the HM26 discussions. <!-- id:GHTO4T-V -->

Today an account's site is rooted at its home document, the document at the empty path, whose `siteUrl` attribute names the server that publishes it. The direction is to move that role onto the [profile](../profile.md) and to make home documents and profiles nodes anchored to a fixed, hard-coded node ID under an empty parent, writable only by the space owner, with a deterministic timestamp on the profile blob so multiple devices converge. A new app version would upgrade existing accounts automatically. <!-- id:rFgb84sn -->

**Affected pages.** [Identity](./identity.md), [Sites](./sites.md). <!-- id:l-OAtBWd -->

# Permissions <!-- id:BE5zABdh -->

**Where it comes from.** 2026-09-03 and 2026-09-10 tech syncs; the August 2026 [permissions investigation](../history/permissions.md). <!-- id:vYaQ-ncg -->

**Today.** A [capability](../capability.md) is signed only by the space owner, grants the role writer or agent, is scoped by path prefix, cannot be re-delegated, and has no expiry or revocation. The proto reserves an editor role, a non-recursive flag and revocation, none of which the daemon implements. See [Permissions](./permissions.md). <!-- id:d-4kczz7 -->

**Direction.** <!-- id:wUEZ-3vs -->
  - Path-scoped and non-recursive capabilities are being discontinued. Invitations will be to a space's home only; a writer of a space is a writer of the whole space. Non-recursive sharing is being removed from the app immediately. <!-- id:ZR3LLWQz -->
  - A group concept, one capability granting several keys at once, is wanted. The team reviewed Keyhive and UCAN and prefers fewer keys: a permanode per space whose admins are permanent, with admin removal done by rotating the permanode. <!-- id:iuciCZaZ -->
  - Revocation and an editor or read-only role remain declared in the proto and unbuilt. No date is attached. <!-- id:-DSldTwV -->
  - The permissions investigation's synthesis, "everything is a grant", proposes one signed statement kind that covers public publishing, private spaces, document sharing, share links and comments, built on the observation that the visibility table already behaves like grants to an audience. It is a design record, not a decision. <!-- id:ehm767Kz -->

**Affected pages.** [Permissions](./permissions.md), [Capability](../capability.md), [Role](../role.md). <!-- id:WDqQGNUs -->

# Private documents, phase two <!-- id:PN557fcS -->

**Where it comes from.** Phase one shipped in the first half of 2026; consensus on phase two at the 2026-08-13 tech sync; transport discussion 2026-09-10. <!-- id:tdmbIO5H -->

**Today.** A Ref, a comment or a change can carry private [visibility](../visibility.md). Private documents live under single-segment paths with random names, are readable by the owner and root writers, are pushed only to the space's declared site server or to authenticated peers, and are filtered out of public-only servers. The daemon currently refuses to create new private documents through its public API: the check is a hard precondition in the create path, lifted only in tests. Existing private documents still work. See [Privacy](./privacy.md). <!-- id:WPa5z3jS -->

**Direction.** <!-- id:vBXm-mY6 -->
  - Phase two is inheritance: children of private documents, an "inherit permissions" idea expressed through metadata rather than path, flat non-human names with redirects, anyone-with-the-link read and write, and an invitation flow that can grant to someone who has no account yet. <!-- id:NzxFqXlh -->
  - Sync permission is not separate from read permission until there is encryption: "no difference between reading and syncing if there is no encryption." Agent delegations need care here. <!-- id:5XCJ9d8d -->
  - At the transport, uploads should carry the context that proves the write is allowed, blobs should arrive authority first, and Bitswap's willingness to accept arbitrary data is seen as a problem that may need a deeper fork of the IPFS stack or an HTTP trustless-gateway transport. The DHT provider system is disabled and there is no DHT in use today. <!-- id:sxmtufGD -->
  - "Public by default" is shifting: as a publishing system it made sense; as a knowledge system, users assume private by default. Private networks are framed as more sophisticated permission and sync rules, not as separate networks. <!-- id:nba6HmcX -->

**Affected pages.** [Privacy](./privacy.md), [Network](./network.md), [Files](./files.md). <!-- id:037QeALn -->

# One sync API instead of subscriptions plus discovery <!-- id:xtBsGDOr -->

**Where it comes from.** May 2026 tech syncs. <!-- id:tmfvL5Uz -->

**Today.** The daemon has two mechanisms backed by one scheduler: periodic sync of subscriptions, derived from local accounts and contacts and invisible to the user, and on-demand discovery, treated as hot and polled more often. The subscriptions gRPC service still exists. See [Network](./network.md). <!-- id:mpGx4hRf -->

**Direction.** Remove subscriptions as a user-facing concept; subscription becomes automatic daemon behaviour derived from what the node's accounts have joined and followed. Discovery grows fine-grained addressing so a client can ask for exactly `/:profile` or `/:comments` of a resource. The team's phrase: one powerful syncing API rather than two incomplete ones. The client-side sync helpers in the web app and the `/hm/api/discover` route are slated to go once the daemon covers them. Immediacy targets are three seconds for comments and under ten seconds for subscribed changes on desktop, with a publish-subscribe pattern for discovery under consideration. <!-- id:stcKGC1K -->

**Affected pages.** [Network](./network.md), [Building with gRPC](../build/grpc.md). <!-- id:M4YdX3p6 -->

# Schemas as daemon resources <!-- id:iI3LuSqT -->

**Where it comes from.** 2026-08-25 and 2026-09-03 syncs. <!-- id:FjWSEiEa -->

**Today.** [Hypermedia Schemas](../schema.md) are documents: a schema-defining page binds a schema blob with `schemaDefinition`, and typed documents point at it with `attributesSchema`. Validation is a guardrail in the app and a TypeScript error for developers, never a gate. No protocol change was made for schemas. <!-- id:IEzkzVPX -->

**Direction.** Schemas should eventually be a daemon-level resource with resources as the primary entity, so the daemon can index and query typed attributes generically. Until then "documents as resources" is the chosen interim. Schema recursion is an open question. Both MIME types and schemas will be supported as ways to say what a value is. The generic indexer for arbitrary attribute queries is being built incrementally and already backs the attribute listings and the query grammar. <!-- id:phy-L64p -->

**Affected pages.** [Schemas](../schema.md), [Query grammar](../build/query-grammar.md). <!-- id:0qktmO8b -->

# A custom CRDT <!-- id:aYbPijmw -->

**Where it comes from.** 2026-09-03 sync. <!-- id:95mzx1ab -->

The team decided to proceed with nodes over the current change data and to defer a generic JSON CRDT. Existing libraries were rejected because they lack history garbage collection and decentralised, signed attribution; a custom CRDT shaped for signed history is the plan. There is an open debate about snapshots versus full history: trustless attribution needs the full history, while signed snapshots that can walk back would be cheaper. Nothing here changes how today's change graph is read. <!-- id:AlhWqqUs -->

**Affected pages.** [Documents](./documents.md), [Change](../change.md). <!-- id:Oi8iBNie -->

# Web of trust <!-- id:bs28BOn2 -->

**Where it comes from.** Long-standing; restated in 2026 notes on trust in the agent era. <!-- id:--IQ-Fjr -->

**Today.** A [contact](../contact.md) is a public statement that you know an account by a name, with two follow flags; it grants nothing and there is no transitive trust anywhere in the code. What exists is a capability system plus a public address book. <!-- id:y0TjDFgN -->

**Direction.** Not a global web of trust in the PGP sense. The team's current framing is federated, community-rooted, contextual trust: endorsements within a community, authority rankings set by an organiser for a group, and moderation that grows from the edge. No data model has been decided. <!-- id:8MGNuMIi -->

**Affected pages.** [Permissions](./permissions.md), [Contact](../contact.md), [Signed content](../why/signed-content.md). <!-- id:DHfDNFj9 -->

# Smaller items with a decided direction <!-- id:giOfHHD6 -->

- **Collections.** A collection is a document whose content is one top-level query block that lists its children. The indexer reports it as `isCollection`, and the older `type: Collection` attribute is ignored. It is a presentation convention in the app, not a protocol concept. See [blocks](./blocks.md). <!-- id:aEqKQ-uD -->
- **Extensions.** A plugin system is planned: documents that carry small apps a site can install, starting with custom pages, then custom blocks, attribute editors and themes. A first attempt was built on a branch and closed without merging in September 2026. The system is being redone and nothing ships today. <!-- id:8zT18av8 -->
- **Comment moderation.** Anyone can comment on anything and there is no moderation in the protocol; deleting and revoking comments on a site was on the mid-2026 launch checklist and remains site-side design. <!-- id:7xb7Glxq -->
- **Relays and reachability.** Networks that block the peer-to-peer port, such as university networks, motivated a proposal for relay addresses on port 443. Status unknown; see [Network](./network.md). <!-- id:dSObFbHp -->

# How to read this page <!-- id:5D6-Vn8W -->

If a concept page and this page disagree, the concept page describes the code and this page describes intent. If the code and this page disagree, the code wins and this page is out of date; please say so in a comment. The [history](../history.md) section holds the dated design records that fed these decisions. <!-- id:Nj5xNvOH -->
