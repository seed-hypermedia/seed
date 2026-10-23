---
name: "Discussion: how are children established?"
summary: Two ways to define children, their privacy and synchronization costs, and why we should choose one naming authority.
---
We are deciding **where the fact “Brief is a child of Project, named brief” lives**. This relationship supplies human-readable paths and sidebar organization. It [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad) no access to either resource. A resource keeps its stable identity when renamed or moved. [Research: separate the meanings of parent](./hm26-children-research.md#pDhPJ4X1). <!-- id:lTQzCyaL -->

**My recommendation is option 2 for curated paths, with one authoritative representation. Private sync needs only one of these representations.** Collections can be an optional query feature; they do not require a second parent hierarchy. This is a design proposal, conditional on directory readers being allowed to see its entries. [Research: why both are not required](./hm26-children-research.md#R3l4t10n). <!-- id:bnMVN8Sq -->

# Option 1: each child declares its parent <!-- id:yI6blCo4 -->

Brief's signed resource state says: <!-- id:Xo_XXAm2 -->

```text <!-- id:OZsZNOg9 -->
Brief C: { parent: Project P, name: "brief" }
```

Project need not list Brief. To display Project's children, query an index for resources whose selected state says `parent = P`. To resolve `project/brief`, query for both `parent = P` and `name = "brief"`. Renaming or moving Brief changes C's placement fields; P need not change. Concurrent moves still need rules to prevent cycles and converge on one placement. <!-- id:NBksml-Q -->

**The benefit is independent publication.** A child writer can place or move their resource without editing a shared parent. Many authors can contribute independently. If C is private, its placement claim can stay private with it: reading P alone reveals no list of private children. <!-- id:AwQlwx9r -->

**The cost is discovering and interpreting incoming claims.** Reading P does not tell a new device which children exist. It needs a [peer](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy2ffc1d)'s reverse index or another way to discover and sync the children before building its own. Listings are complete only for the source's known, permitted scope. Filter before exposing names, counts, fingerprints or events; filtering after downloading private metadata is too late. This is implementable, not inherently insecure. [Research: comparison and index requirements](./hm26-children-research.md#2yPoOazb). <!-- id:BatAXUSk -->

A child's signature proves its writer made the claim—not that Project accepted it. If anyone may claim membership, the namespace needs rules for unwanted entries and duplicate names. Requiring parent approval adds another mechanism. Two children may both claim `brief`; choosing among only readable candidates can even make the same path resolve differently for different readers. [Research: naming conflicts under partial visibility](./hm26-children-research.md#DJhQEQIm). <!-- id:CXN9AJPk -->

# Option 2: the parent explicitly lists its children <!-- id:zELJJpSi -->

Project's signed resource state says: <!-- id:GJcMxlLm -->

```text <!-- id:r8L27s5d -->
Project P: { children: { "brief": Brief C } }
```

Brief need not declare a parent. Read P, look up `children["brief"]`, then open C using C's own access rules. Project's writer controls this name; they need not be able to edit Brief. Renaming changes P's map. Removing the entry unlinks Brief; it does not delete Brief or revoke anyone's access. <!-- id:hcHKQ7rJ -->

**The benefit is explicit, verifiable inclusion.** A selected parent version tells a reader exactly which names it contains. A new device can discover those entries by syncing P, without searching for incoming claims. This resembles a document explicitly containing child cards. It also permits several directories to name the same resource: these are aliases, not conflicting claims about one canonical parent. [Research: directory semantics](./hm26-children-research.md#R3l4t10n). <!-- id:OYsV5KF_ -->

**The cost is shared editing and coordination.** Creating C and listing it in P are two writes. Someone who can write C but not P cannot insert it unilaterally. Moving an entry between directories requires removing one binding and adding another; partial sync may temporarily show both or neither. Concurrent edits need merge rules, especially when two writers assign the same name. A logical map need not be retransmitted wholesale, but it does not eliminate contention or settle merge semantics. [Research: existing double-publication problems](./hm26-children-research.md#2nXswgEh) and [map implementation limits](./hm26-children-research.md#TTujJ9jF). <!-- id:swFZYiJ2 -->

# The privacy tradeoff: who can see the relationship? <!-- id:oI6kYFIe -->

With option 1, the relationship is disclosed to readers of the child statement. With option 2, it is disclosed to readers of the parent state. **Neither direction automatically hides relationships.** <!-- id:Mv_fl1uu -->

A public Project can list `acquisition → C` while C's content stays private. That is acceptable only if revealing the name, target ID and relationship is intentional. Show an unavailable entry without fetching a private title or preview. If the entry itself must be secret from some Project readers, a shared plaintext map cannot provide that. Use a narrower directory audience or separately protected entries, adding complexity. Hiding a sidebar row does not hide the underlying signed map or its history. [Research: the metadata boundary](./hm26-children-research.md#-fIRq94L). <!-- id:xvd6SYl6 -->

# Why choose one, and what private sync actually needs <!-- id:QsOKJdlb -->

For curated paths, I favor option 2 because **the party responsible for a name publishes its binding**, and syncing that directory discovers its entries. The minimal flow is: <!-- id:Rb9ugu9a -->
  1. Sync P under P's permissions. <!-- id:INfVQpG9 -->
  2. Read its name-to-resource bindings. <!-- id:5Ohc-kJ9 -->
  3. Independently authorize and sync each requested target C. <!-- id:pwopB1dw -->

An entry creates interest, not permission. A directly shared child must also open by stable ID without readable ancestors. Pretty paths become an optional naming layer; sidebar order can be stored separately. A [manifest](./hm26-children.md#zELJJpSi) proves its contents at one version, not that no newer version exists. [Research: sync API consequences](./hm26-children-research.md#tq_CULFl). <!-- id:bYtc6SkO -->

I would **not also require `C.parent = P`**. That duplicates the hierarchy and creates a new question whenever the two disagree. A reverse index of P's entries is enough for known backlinks. Requiring exactly one canonical parent would be an additional constraint, with move/conflict rules; this proposal deliberately permits directory aliases. Breadcrumbs follow the route used to reach a resource, rather than an intrinsic unique parent. [Research: candidate direction and remaining decisions](./hm26-children-research.md#TuxYP4U-). <!-- id:NT3rVJ2n -->

Collections solve a separate need: “show all readable resources tagged research” updates automatically; “these are Project's named entries” records an editor's choices. Both features are justified only if we need both automatic discovery and curation. A query need not use a `parent` field, and it need not reserve paths. **Start with explicit entries alone if curated navigation is the requirement. Choose option 1 instead if independent child publication and private placement dominate.** [Research: when each approach fits](./hm26-children-research.md#R3l4t10n). <!-- id:kZ16qRoG -->

Keyline informs authority evaluation; it does not choose a navigation model. Willow's path-scoped areas differ from HM26's proposed [exact-resource](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/authority-model#sy5de953) [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad). Its Confidential Sync design is paused; newer WTP checks capabilities but exposes request metadata to [peers](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy2ffc1d). These are useful ideas, not evidence that either child model automatically provides confidential discovery. [Research: primary sources and limits](./hm26-children-research.md#2z1B-cNn). <!-- id:UMPONqma -->

# Learn this in the sync playground <!-- id:sx5f8370 -->

Sync playground extension · 2026-10-23. Teaching prototype; no production protocol or schema adoption. <!-- id:sxa3f292 -->

The sync experiment opens [exact-resource scopes](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/peer-rpc#sy5f161c). Structural children remain a separate placement relationship: neither a tree edge nor a recursive request [grants](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability#sy3492ad) permission to every descendant. A future recursive implementation must independently authorize each included resource and fence membership changes. <!-- id:sxafc250 -->

Read next: [Reference](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy52367a) · [Scope](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/peer-rpc#sy5f161c) · [Permissions](hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/authority-model#sy8f76fd). <!-- id:sx349ba3 -->


Source: [Starlight HM26 discussion](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/children), retrieved October 24, 2026. This copy includes the later sync explanations and cross-references.
