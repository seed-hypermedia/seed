---
name: HM26 parent and child relationships — research notes
summary: Evidence, alternatives and unresolved questions assembled before the concise discussion report. Research checked October 22, 2026.
showOutline: true
---
This is the working research document, prepared before the final synthesis. Recommendations below are analysis, not adopted HM26 rules. Scope: naming, path resolution and navigation; a parent/child relation [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad) no resource access. <!-- id:1-MmYdi9 -->

# Evidence and disagreements <!-- id:DPZ34R0K -->

The live [HM26 overview](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26) now uses Resource/BaseResource and state terminology. Identity is the initial resource [CID](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy542462). Optional parent/name fields remain provisional. The [authority model](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/authority-model) proposes [exact-resource](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/authority-model#sy5de953) [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad), bound admin proofs, current-standing write evaluation, and same-root moves by a child writer without parent authority. Those operational choices are explicitly tentative. Permanent admin grants and admin-only reader/writer [revocation](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/revocation#sy2a3c5f) are recorded as settled in these drafts. <!-- id:2tQChrSl -->

The local protocol roadmap records an older direction requiring authority over both sides to create a name in a parent, with exactly one parent and no hard links. This differs from the tentative child-writer-only move rule. The current discussion should decide naming admission explicitly rather than silently combining them. The roadmap also already contemplates a pretty-path/redirect layer outside permanent identity. <!-- id:RB0LhdTh -->

[Alex's hierarchy proposal](https://hyper.media/hm/z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/projects/private-document-hierarchy-and-authorization) separates identity, placement and authority. Its lower stable-ID/permanode sections are marked outdated. Its Keyline delegation rules also differ from HM26's narrower policy. Neither it nor the generated Stem proposal should override the current HM26 draft. <!-- id:cgTPOERs -->

The [October 15 tech sync](https://hyper.media/hm/z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/meeting-notes/2026-10-15-tech-sync) asks for permission user stories and efficient sync: private threads with independently authored messages, separate agent conversation/configuration rights, and personal unread/bookmark/subscription state. The [October 20 notes](https://hyper.media/hm/z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/meeting-notes/2026-10-20-hypertuesday) record continuing Keyline study, not a new parent/child decision. <!-- id:5AkSR97v -->

# Separate the meanings of parent <!-- id:pDhPJ4X1 -->

<!-- id:wQuVzIyF -->
1. **Placement claim:** C says it belongs under P, with name n. The claim is authenticated by C's writer. It does not prove P accepted it. <!-- id:3-QWjHUZ -->
2. **Directory entry:** P names C as n. P's writer controls that name. It does not prove C agrees that P is its canonical parent. <!-- id:ZeYoxi63 -->
3. **Collection membership:** a query over visible resources produces C. Membership can change with the viewer, filters and replica knowledge. <!-- id:mPV2vaSA -->
4. **Navigation:** an ordered selection of entries, cards, collections and local pins. A map does not by itself define sidebar order. <!-- id:KKFXxYsy -->

None of these means ownership, inherited permissions, retention, deletion of descendants, or automatic content replication. Those need separate contracts. A directory can link to an independently owned resource just as a document can link to another document. <!-- id:VaTeyuZs -->

# Comparison <!-- id:2yPoOazb -->

<!-- id:NZTYhRdM -->
| Concern <!-- col:t0bo49tm --> | Child declares parent <!-- col:J7dF1hqg --> | Parent stores name → resource <!-- col:GAmkAF6- --> <!-- id:2yk3Gbjc --> |
| --- | --- | --- |
| Who authors the relation? | Child writer | Directory writer <!-- id:e1w4y-ll --> |
| Discover children | Reverse query over known, authorized claims | Read directory state <!-- id:FVHWbBwe --> |
| Evidence for a name | Child proves its claim; acceptance needs another rule | Directory directly authenticates its own binding <!-- id:fpxytQYj --> |
| [Completeness](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#syeebbf6) | Relative to a replica's indexed scope and visibility | Complete for the selected directory version, once fully materialized; not proof of global freshness <!-- id:YgdywNOV --> |
| Independent creation | No parent edit needed unless admission requires it | Child creation and directory insertion are separate writes <!-- id:YRJaEYGN --> |
| Privacy of membership | A private child can hide its claim from parent readers | All readers of a plain map learn every entry's label and target <!-- id:u2AqTzE- --> |
| Contention | Writes distributed across children | Shared directory is a write hotspot <!-- id:bA-CmfO- --> |
| Naming collisions | Several children can claim the same name | Concurrent assignments to one map key still need merge rules <!-- id:CBFLnBL1 --> |
| Moving | One placement update, but concurrent moves can form cycles | Remove/add across two directories; partial sync can show both or neither <!-- id:tMK10iXU --> |
| Multiple appearances | One canonical parent per selected child statement; other links separate | Aliases and multiple directories are natural <!-- id:CmKv0QaU --> |

Option 1 is not inherently insecure. An index can be derived locally after authorized sync, or served with correct per-caller filtering. Its hard parts are discovery, admission, [completeness](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#syeebbf6), conflicts and invalidation. A query that says “known readable children” is honest; claiming a complete global directory from that query is much stronger. <!-- id:LXS_JBwe -->

Option 2 simplifies directory discovery and naming verification under a common metadata audience. It does not eliminate indexes, target authorization, [revocation](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/revocation#sy2a3c5f) handling or pagination. Its advantage narrows when every entry must have a different audience. <!-- id:REfwPGLv -->

# The metadata boundary <!-- id:-fIRq94L -->

Suppose a team directory contains `acquisition → C`, and only two people can read C. Publishing that entry to all directory readers reveals the project name and a stable correlation identifier, while leaving C's body private. That can be a valid product decision; it must be intentional. A generic locked/unavailable row is appropriate when the entry is visible. Do not fetch the child's title, thumbnail, existence status or descendants without authorization. <!-- id:83-3V7Xa -->

If even membership must be secret, do not place that plaintext entry in a broadly readable signed map. Filtering a rendered list is insufficient if clients can fetch the original map or its history. Use a narrower directory audience, or separately protected entry records/shards, or encrypted entries. These introduce additional objects, key management or filtering; they are alternatives to evaluate, not a free property of explicit children. Omitting the label while revealing a stable target can still expose correlation or membership. <!-- id:bUuFxnMd -->

The reverse direction also matters: if C's private state carries its parent ID/name, anyone allowed to read C learns that placement metadata even without reading P. A directly shared child must remain openable by stable ID without access to ancestors. Avoid reconstructing hidden ancestor names in breadcrumbs. <!-- id:63sxl57z -->

# Implications for the sync API <!-- id:tq_CULFl -->

The existing [peer proposal](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/peer-rpc) already filters before listing, counting, fingerprinting and emitting events. Its [workflows](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/sync-workflows) distinguish ordinary references from state/content dependencies, and require independent authorization for recursive targets. <!-- id:zbP8qpy_ -->

Candidate minimal contract: <!-- id:VvuQMiRT -->
  - Sync directory P as an ordinary authorized resource. Its entries are state; their targets are ordinary references. <!-- id:jo8LOQWg -->
  - Resolve n against a specified [selected version](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource#sy3ff6c0) of P; return the target identity and binding provenance. Knowing the binding does not authorize target fetch. <!-- id:7BhLz0hd -->
  - Sync C through its own resource access check. “Follow directory” schedules this for each target, with deduplication, cycle detection and budgets. <!-- id:OJ1RG-x_ -->
  - Keep collection queries as derived views over readable resources; document their [completeness](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#syeebbf6) boundary separately. <!-- id:Pg9iOXkz -->

This reuses the same [exact-resource](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/authority-model#sy5de953) transfer API for both models. Neither model requires the transport to understand a sidebar. A recursive convenience API may still exist, but its membership and authorization must be reevaluated when relevant [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad), entries or child states change. A stale scope never becomes an access lease. <!-- id:yJrrgIAi -->

The [index proposal](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-index) already has derived parent/name indexes and permission-filtered scope membership. With explicit entries, reverse indexes remain useful for backlinks; they cease to be the authority for forward name resolution. No performance winner is established without measuring fan-out, writer contention and audience fragmentation. <!-- id:f7rr3m8j -->

# Prior art: transferable lessons and limits <!-- id:2z1B-cNn -->

[Keyline's design](https://github.com/inkandswitch/keyhive/blob/83e079de0e9e88ea9adff4e4afa89500e9eee9fa/design/keyline/README.md) concerns authority derived from signed delegation/revocation sets. Its graph nodes are keys, not UI folders. It uses live graph routes and four power levels; HM26's bound proofs and permanent admin [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad) are distinct choices. Its partial-visibility discussion requires enough authority evidence to evaluate routes; a [directory manifest](./hm26-children.md#zELJJpSi) cannot supply that [completeness](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#syeebbf6). Keep authority reconciliation separate from naming. Starlight's [Keyline curriculum](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/keyline) provides surrounding context, not a replacement specification. <!-- id:hudvQN1O -->

[Willow's data model](https://willowprotocol.org/specs/data-model/index.html) is a hierarchical keyspace organized by namespace, subspace, path and timestamp, not a resource graph with [parent manifests](./hm26-children.md#zELJJpSi). Parent entries need not exist to name deeper paths. Its prefix-pruning behavior makes direct use of human navigation paths consequential: a newer prefix entry can remove older descendants in the same subspace. [Meadowcap](https://willowprotocol.org/specs/meadowcap/index.html) scopes [capabilities](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad) by areas, including path prefixes; that is different from HM26's proposed exact resource grants. An arbitrary map of independently authorized resources is not automatically one Willow area. <!-- id:kO9sfLxQ -->

[Willow'25](https://willowprotocol.org/specs/willow25/) selects interoperable parameters; it does not decide HM26's hierarchy. [Private interest overlap](https://willowprotocol.org/specs/pio/index.html) is useful research for learning shared sync interests without openly advertising paths. The [Confidential Sync spec](https://willowprotocol.org/specs/confidential-sync/index.html) is marked paused and partly outdated. [WTP](https://willowprotocol.org/specs/wtp/index.html), marked Proposal as of October 16, 2026, offers capability-checked requests and watches but explicitly warns about metadata disclosure. Do not claim transport encryption alone conceals interests from the connected [peer](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy2ffc1d). Starlight's [Willow review](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/video-curriculum/willow-review) caught that distinction in the October 21 curriculum. <!-- id:ucBbMc9N -->

[Encrypted Willow](https://willowprotocol.org/specs/e2e/index.html) discusses application-applied encryption while preserving structure needed for merging. It does not make metadata universally invisible or supply automatic end-to-end encryption. Neither parent model resolves untrusted-server encryption on its own. <!-- id:NcdkW9yZ -->

The [replicated-tree move research](https://martin.kleppmann.com/2021/10/07/crdt-tree-move-operation.html), also linked in the team's hierarchy comments, supplies a convergent algorithm preserving a tree under concurrent moves. It addresses a different invariant from naming admission or private listings. Use it if a strict canonical tree is a requirement; permitting a graph of navigation links avoids imposing that global invariant on every resource. <!-- id:0mYuqyEW -->

# Candidate direction to test <!-- id:TuxYP4U- -->

Favor parent-owned entries as the single authority for curated names, with a directory as ordinary resource state. Do not also require children to store a matching parent pointer. Stable IDs remain canonical; human paths resolve through explicit bindings. Collection queries are an optional application feature, not a second hierarchy required by private sync. The initial synthesis blurred this distinction by recommending both options; that recommendation is narrowed here. <!-- id:Nrq6_3y7 -->

This deliberately revisits the older one-parent/no-hard-links direction. If exactly one canonical parent is still required, specify it separately and budget for move/conflict machinery. Removing a directory entry should unlink, not delete or revoke C. Renaming should change bindings, not C's identity or [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad). Under the tentative current-standing writer policy, revoking a directory writer may also roll directory state back; this remains an HM26 policy decision. <!-- id:HzhcN_2X -->

Questions for the final discussion: Must a child writer independently appear in a directory? May directory readers learn inaccessible child names? Is one canonical parent actually necessary? Must a namespace support millions of independently arriving children? Answers can change the recommendation. <!-- id:W7x-_mM5 -->

# Additional checks before synthesis <!-- id:feReyrjn -->

The [parent-card project](https://hyper.media/hm/z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/projects/subdocuments-appear-in-the-parent-content) explicitly describes a child publication followed by a parent-link publication, with failure/draft recovery, and leaves query-block interaction open. The [unreferenced-documents story](https://hyper.media/hm/z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/design/stories/authoring/unreferenced-documents), containing an October 21 recording reference, distinguishes a resource's location from whether its parent content links to it. This is concrete product evidence that the two relations already diverge. The recording itself was not reviewed. <!-- id:2nXswgEh -->

The [relationship-predicates proposal](https://hyper.media/hm/z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/tech/relationship-predicates) recommends storing one direction and deriving inverses, with separate structural, referential and conversational predicates. That is useful when two directions mean the same fact. A child's placement claim and a parent's accepted directory entry can instead be different assertions by different authorities; if both are retained, name them differently and define which controls resolution. <!-- id:3FjVTxGM -->

A subtle name-conflict issue: if two children claim the same parent/name and only one is readable, selecting the winner after filtering may send different users to different resources at the same path. Selecting globally first may make the path unavailable because of an undisclosed winning child. Neither behavior should be accidental. A directory-owned binding separates naming authority from target-readability. A filtered or selectively disclosed directory still needs explicit resolution semantics. <!-- id:DJhQEQIm -->

The proposed map is a logical structure, not a requirement to retransmit one giant [blob](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#syfa2c8c) per insertion. Change [DAGs](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy512d0f) or an authenticated paged map can reduce transfer costs. However, HM26's deterministic apply/merge contract remains open; “use a map CRDT” does not specify concurrent same-name assignment, deletion, or atomic cross-directory moves. A shared directory also does not fit all private-thread messages or autonomous child creation: collection-style relations remain useful. <!-- id:TTujJ9jF -->

# Revision: why both are not required <!-- id:R3l4t10n -->

The two options answer the same structural question in different places. In option 1, a selected child statement contains `parent: P, name: brief`. In option 2, P's selected state contains `children: {brief: C}`. A reverse index of the chosen representation is a cache, not a second authoritative fact. Requiring both signed assertions to agree adds synchronization and disagreement handling. Private sync does not itself require that duplication. <!-- id:dl103aLP -->

Option 1 is a good fit when inclusion is driven by independently writable children: incoming submissions, independently authored messages, or many privately shared items that should not all become visible in one parent's state. Finding them still requires a source of candidate child IDs or an authorized index. Knowing P does not by itself reveal C, and a reader cannot build the inverse query from resources they have never discovered. A local index is sufficient once those resources have been synced by other means. If the parent must approve names, a separate admission mechanism is needed; child authorship alone cannot prove acceptance. <!-- id:gX9SvTml -->

Option 2 makes curated inclusion explicit. P's authorized writer assigns a name to C; C need not be writable by that person, because naming C is not editing it. If child consent or a unique canonical parent is required, this simple directory-link interpretation is insufficient and must be extended. The [manifest](./hm26-children.md#zELJJpSi) establishes a set relative to its [selected version](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource#sy3ff6c0). It does not guarantee that this is the latest version known anywhere. Child creation plus listing, and a move between two directories, require separate writes unless a transaction protocol is added. <!-- id:5DVE1Zj- -->

Queries can be useful alongside either option without duplicating structural parenthood. A saved filter such as `tag = research` returns independently authorized matches; adding a tag does not reserve a pretty-path segment or insert a curated directory entry. An explicit listing answers what a directory editor chose. A query answers which known visible resources match. Only an actual product need for both manual curation and automatic discovery justifies maintaining both features. If the first release needs only curated paths/sidebar entries, implement only explicit entries and [exact-resource](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/authority-model#sy5de953) sync. Do not build a generic relation engine for this proposal. <!-- id:2_abJJiP -->

For a workload dominated by self-organizing private children, choose option 1 instead. For a workload requiring both a curated public directory and a private intake query, offer the query as a distinct view with explicit [completeness](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#syeebbf6) and disclosure rules. A canonical child-parent field is not a prerequisite for such a query. This is a conditional recommendation based on product semantics, not a measured performance result. <!-- id:ZBzVr-oR -->

For either representation, a valid relationship is data with its own audience. Child-owned placement inherits the audience of the child statement that carries it; parent-owned placement inherits the audience of the parent state. Both can deliberately reveal IDs to people unable to read the referenced resource. Independently hiding relationship metadata from the containing resource's readers requires a separate protection boundary. <!-- id:cH5UZezY -->

# Coverage <!-- id:7MM3AFz9 -->

Read the live HM26 overview, authority model and design questions; inspected relevant peer/workflow/index sections; read the hierarchy proposal and October 15/20 meetings; inspected Starlight Keyline/Willow curricula and review sections. Searched Seed for HM26, Keyline, Willow and parent relationships. Consulted primary Keyline and Willow specifications and the tree-move authors' publication page. Older local HM26 research and the repository roadmap supplied context. This is targeted design research, not a security audit, implementation benchmark or exhaustive review of all team documents. <!-- id:6gDXf7df -->

# Learn this in the sync playground <!-- id:sx330b4c -->

Sync playground extension · 2026-10-23. Teaching prototype; no production protocol or schema adoption. <!-- id:sx6b7dc0 -->

The stable two-peer graph is an observer teaching layout, not a new children index or network inventory. It exposes content containment and permission evidence as separate views so placement, set membership and authority are not conflated. <!-- id:sxbdf692 -->

Read next: [DAG · dependency graph](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy512d0f) · [Scope](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/peer-rpc#sy5f161c) · [Not held · observer outline](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#syffa635). <!-- id:sxc38985 -->


Source: [Starlight HM26 discussion](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/children-research), retrieved October 24, 2026. This copy includes the later sync explanations and cross-references.
