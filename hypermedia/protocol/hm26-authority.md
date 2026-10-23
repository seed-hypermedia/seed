---
name: The HM26 authority model
summary: The tentative first policy for roots, grants, revocation, current-standing authorization, sync and service custody in the HM26 redesign, written down so it can be simulated and argued about before anything ships.
---
This page describes a proposed policy, not shipped behaviour. The [daemon](../apps/daemon.md) implements what [Permissions](./permissions.md) describes today. [Where this is going](./roadmap.md) records the decisions behind the HM26 redesign. This page fills the gaps those decisions leave with one concrete, reviewable first answer per question, so that the [HM26 playground](../apps/playground.md) can simulate it and the team can test the consequences by hand. Every answer below can be replaced on its own. The research behind it, from October 2026, compared Keyhive, Keyline and UCAN with the team's own notes and chose simpler rules where the drafts allowed it. <!-- id:0GLeoXJc -->

# The questions and the first answers <!-- id:q7iNbxFY -->

<!-- id:xHiMGv7G -->
| Question <!-- col:k-IuYc0T --> | Tentative answer <!-- col:TNwVE_-n --> | Consequence <!-- col:VroWMXGx --> <!-- id:RPNNFR2- --> |
| --- | --- | --- |
| Scope | An exact resource: the original node CID | No implicit subtree grant. A recursive sync checks each resource. <!-- id:0b7pDdhm --> |
| Roles | Reader reads. Writer reads and writes. Admin reads, writes, grants and revokes. | No fourth role. Role implication is a recommendation. <!-- id:Npmn3a1X --> |
| Delegation | Only admins issue grants | Readers and writers cannot invite others. <!-- id:tr-XyC_i --> |
| Proof | A grant from a delegated admin names the exact admin grant that proves the issuer's authority. The owner's own admin grant has no proof. | Proofs are binding dependencies, not hints. <!-- id:qMKV6aAc --> |
| Multiple grants | Rights are the union of every independently valid grant | Revoking one grant does not ban a key that has another route. <!-- id:nPKByPhi --> |
| Revocation | A reader or writer grant is revoked by a blob naming the exact grant and a same-scope admin proof. Admin grants and their ancestry are permanent. | Validators build the admin graph without consulting revocations. <!-- id:fPS_GLvu --> |
| Creation | The expected root principal signs the initial node and its resource policy | Delegated creation needs a later rule. <!-- id:8XIm8WzT --> |
| Current writes | [Refs](../ref.md) are evaluated against the authority known now | Writer revocation can change which Ref is selected. <!-- id:aYutYNpd --> |
| History reads | Current readers may read the history that currently authorized Refs adopt | Other retained bytes are kept but not served. <!-- id:UFvKGR7V --> |
| Service custody | A host that holds plaintext needs reader rights, and the uploader verifies the host's principal first | A service receives plaintext as a reader, never through transport privilege. <!-- id:xYk-shYq --> |

The settled parts, confirmed in the team's HM26 discussions, are the three roles, that admins may grant admin, that admin grants and their ancestry cannot be revoked, and that only a same-scope admin revokes a reader or writer grant. Issuing or receiving a grant gives no independent right to cancel it. <!-- id:5YB7yWMj -->

# Roots and the resource policy <!-- id:b4HgY4uP -->

A CID authenticates bytes. It does not name a trusted root. A client starts from a pair, the resource's original CID and the principal it expects to own it, which it gets from a space address, a signed invitation or an identity it accepted on purpose. A server cannot substitute a different root in its reply. <!-- id:HtlF_RMi -->

The proposal adds one signed fact that the current node and capability formats do not express: a resource policy. It names the resource, the expected root principal, whether the resource is readable by the public, and optionally the admin grant that signs it. The first policy is signed by the root and refers to the root-signed initial node. Later policies keep the resource and root the same and are either root-signed or carry a valid admin proof. Among several, the highest signed timestamp wins, with the binary CID as a tie-break. The root key is an implicit admin of its resource. <!-- id:3EYAkaOw -->

Public reading is a policy, not a role and not a grant to an invented key. Making a resource public discloses its then-current blob closure. That disclosure cannot be undone locally: a later private policy stops new versions from being served, but bytes that were public stay public. Public readers never learn the membership roster. They receive only the writer and root evidence needed for the Refs they can see. <!-- id:t2V8qMSp -->

# How authority is evaluated <!-- id:h50bgZvd -->

For one resource, within one consistent index revision: <!-- id:YVbW2GfD -->
  1. Verify hashes, envelope signatures and the closed structural rules. An unknown format is not authority. A missing dependency yields unknown, never success. <!-- id:uYkK9Eob -->
  2. Ground the admin graph at the trusted root. A root-issued admin grant is valid. A delegated admin grant is valid only when its proof is a valid admin grant on the same resource whose delegate is the issuer. Iterate to a fixed point. A cycle with no root connection grants nothing. Revocations are never consulted here. <!-- id:qt4WwTDr -->
  3. Validate reader and writer grants the same way. A revocation is valid only if its signer is the delegate of the admin proof it names, and its target is a reader or writer grant on the same resource. A target that has not arrived yet keeps the revocation waiting. <!-- id:bqgAUu7t -->
  4. A reader or writer grant targeted by a valid revocation is inactive, whatever the arrival order. A revocation is permanent for that grant's CID. A newly issued grant is a new CID and may restore rights. <!-- id:_HRFJCX1 -->
  5. Union the rights of the valid active grants per principal, and evaluate public reading separately. A cache row records the authority revision it was computed at and never creates authority. <!-- id:zW2oBdI5 -->
  6. A Ref is a candidate when its signature is valid, its fields are valid, it names the right original node, and its signer can write the resource right now. The highest signed timestamp is selected, with the binary CID as a tie-break. A missing state dependency does not make the older Ref current: the newer one is selected and its materialization is marked incomplete. Placement is derived separately and grants nothing. <!-- id:Xpt_W1xM -->

# What writer revocation means for state <!-- id:X7xnwbX0 -->

This is the biggest open choice, and the proposal makes it visible rather than hiding it. Under current-standing evaluation, revoking Carol's last writer grant makes her Refs ineligible. The next authorized candidate wins, which can roll the displayed resource back to an older version. Her bytes stay retained, and a surviving authorized Ref may still adopt her changes in its DAG. Granting Carol again can revive her old Refs, including one with a high timestamp. <!-- id:oHSVEPOG -->

An admin who wants a version to survive a revocation publishes an authorized Ref that adopts its state. If that rollback and revival behaviour is unacceptable, the alternatives are signed adoption receipts, in which an admin certifies particular Refs; a serialized authority cut that writes bind to; or explicit causal revocation semantics. Each adds signed facts or coordination. Wall-clock timestamps and the existing Ref generations cannot prove when an offline edit became authorized, so the proposal does not pretend they can. <!-- id:JRh7Eglm -->

# Sync and the live fence <!-- id:AF19Fbb7 -->

A reader's sync has two sides. The reader needs a valid read route on the exact resource, and the host it syncs through needs a reader grant of its own on that resource. Following a resource schedules work. It never grants access. Knowing a CID, or a hyperlink from a resource the reader can see, does not expand the authorized set. <!-- id:61cOjeZO -->

A sync authenticates both principals, refreshes control evidence, opens a scope bound to the current authority revision, reconciles only the authorized set, fetches and verifies, commits before acknowledging, and then watches. If authority changes while a scope is open, the next transfer stops at the fence: the view is invalidated and nothing further is disclosed until control is refreshed. Bytes already received are not recalled, and an offline device keeps what it has with stale authority knowledge. An honest online peer stops disclosing after a valid revocation; the model does not promise an instant global deadline. <!-- id:0HGAGUG4 -->

A removed principal keeps one narrow right: after authenticating as the delegate of its old grant, it may fetch that grant's revocation record and the admin evidence behind it. It may not list other members or fetch content. <!-- id:Tsdf6l-- -->

# Decisions still needed <!-- id:irElPAQQ -->

- Approve or replace the root, role and scope policy, including the resource policy format and a recovery story for a compromised root, since permanent admins cannot be removed by ordinary revocation. <!-- id:2A-9G7sz -->
- Choose history semantics: whether current-standing rollback and revival is acceptable, whether joining readers see retained history, and whether signed adoption is required. <!-- id:YZqY9zd5 -->
- Specify deterministic apply execution for change DAGs. The exact immutable apply CID is settled; the executable format, sandbox and compatibility are not. <!-- id:VPr3AquY -->
- Review disclosure: the minimal evidence rules, personal post-revocation control access, the public-to-private transition and plaintext custody on servers. <!-- id:_65IpC7_ -->
- Decide placement rules the draft leaves open: name conflicts between siblings, cross-root moves, cycle repair. The playground labels its own choices as lab conventions. <!-- id:_DjmMZqz -->
- Plan the migration from today's owner, path-writer and agent capabilities. Devices must not be promoted to permanent admin by default. <!-- id:ZpOEfFKh -->

# Working with it <!-- id:lUnrJiJM -->

The schemas this page assumes are published in the [HM26 space](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26): [capability](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability) with its [admin](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability-admin) and [revocable](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability-revocable) forms, [revocation](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/revocation), [resource](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource) and the Ref kinds [state](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-state), [changes](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-changes), [changes with state](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-changes-state), [tombstone](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-tombstone), [redirect](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-redirect) and [republish](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-republish), plus the [authority model](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/authority-model), [sync workflows](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/sync-workflows) and [permissions guide](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/permissions-guide) notes that this page condenses. The [HM26 playground](../apps/playground.md) in the desktop app implements this page as a simulator. Each use case in it is a preset of blobs, and its API answers the questions in the table above for any world you build from one. Today's daemon implements none of it; see [Permissions](./permissions.md) for what ships. Nothing on this page changes a blob format, and the [roadmap](./roadmap.md) stays the record of what is decided. <!-- id:oW-ln3iq -->
