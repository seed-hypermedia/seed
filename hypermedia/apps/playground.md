---
name: The HM26 playground
summary: A simulator for the tentative HM26 authority and sync design that the desktop app serves from its own API server at /hm/playground, with the use cases, the editor, the HTTP API, and the limits of what it proves.
---
The HM26 playground is a simulator for the [HM26](../protocol/roadmap.md) authority and sync design. It lives inside the [desktop app](./desktop.md): the app's own API server serves the page at `/hm/playground` and keeps the simulated world behind `/api/playground`. Keys, CIDs, signatures and peers are simulated. Nothing it does touches the [daemon](./daemon.md), a real [capability](../protocol/permissions.md) or the network. It exists so the team can try the rules in [The HM26 authority model](../protocol/hm26-authority.md) by hand before any of them ship. <!-- id:MWdvRIAT -->

# Open it <!-- id:tVmeoPg6 -->

Run the desktop app in development and open the page in a browser: <!-- id:r1EDyvAw -->

```bash <!-- id:z2LQ17uY -->
./dev run-desktop
open http://localhost:58004/hm/playground/
```

A packaged app serves it on its production API port, so `http://localhost:56004/hm/playground/`. In the app, **View → HM26 Playground** opens the same page inside the app window, where links to Hypermedia documents open as app routes. The world is saved on the node after every change, in `playground/world.json` inside the app's user data folder, so the page can be closed and reopened and the experiment is still there. Undo history and the loaded use case survive a restart too. Each browser remembers only its own selection and sync dropdowns. <!-- id:zO5BlNbn -->

# What it shows <!-- id:NPvZ8sjh -->

The page is one view. The **use case** dropdown at the top loads a preset of blobs: two routes with one revoke, permanent delegation, child sharing, the writer rollback, regrant and revival, copy then cut access, and the full fixture with everything at once. Each use case is its own small world with only the keys, resources, grants and Refs its point needs, usually one document and two or three keys. The page says when the loaded world has been changed since. <!-- id:0PKWgxTS -->

The world column lists every key, then every resource, in one of four views. **Blobs** is the flat list: the grants, revocations and [Refs](../ref.md) on each resource, each with the status the API derived, so a grant is valid, revoked or invalid and a Ref is selected, older or ineligible. A Ref here is what it is in the protocol, a signed claim about what a resource currently shows, with one simplification: a snapshot Ref carries its content inline instead of naming change heads, so a world can be read without a change DAG. Tombstone and redirect Refs mean what they mean in the protocol, and the changes kinds name heads the way a version Ref does. **Authority** is a graph: resources along the top, keys along the bottom, and every grant as a ticket between them with a line in from its issuer, an arrow out to its recipient and a dotted line up to the one resource it covers. A revoked grant is dashed and carries its revocation. The add-grant button opens the editor on the selected resource. **Placement** draws the folder tree, with the selected Ref under each resource and buttons to add a child or a Ref. Nesting is placement only and grants nothing. Selecting anything in any view shows its details on the right: its fields, the facts derived from it, and a read, write, admin and sync table for the keys on that resource, or for that key on every resource. Selecting a row of the table names the grants that explain it. A blob the rules cannot evaluate, such as a grant whose proof is held by someone else or a resource placed inside another owner's tree, is marked invalid in every view, and its details list what is wrong. Every blob's details and editor link the page in the [HM26 space](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26) that defines it: a grant to [capability-admin](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability-admin) or [capability-revocable](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability-revocable), a revocation to [revocation](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/revocation), a resource to [resource](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource), and a Ref to the page for its kind, such as [resource-state](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-state) or [resource-tombstone](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-tombstone). <!-- id:PXs-Hkrd -->

Adding a blob opens a short form with one blob type at a time: a key, a resource, a capability, a revocation, a Ref or a resource policy. The form asks only for what the model needs, and it does not refuse a wrong blob: whatever you save is stored, and the page shows what the rules make of it. Proofs come from the admin grant the signer holds on the resource, and sequence numbers follow the last Ref. Capabilities cannot be edited or deleted. Reissuing a capability appends a new grant with a `reissuedFrom` note and leaves the original intact. The old grant stops working only through a separate revocation, and admin grants cannot be revoked at all. Keys, resources, Refs and revocations can be edited and removed as fixture changes. Undo covers everything. <!-- id:kDR4eZq2 -->

# The rules it simulates <!-- id:72ryXveI -->

The playground implements the first policy proposed in [The HM26 authority model](../protocol/hm26-authority.md). In short: <!-- id:yH7RTTQX -->
  - A grant is scoped to one exact resource. A grant on a parent never authorizes a child, and a child grant never reaches the parent. <!-- id:uNTlvuY_ -->
  - Roles are reader, writer and admin. Writer includes read. Admin includes read, write, grant and revoke. <!-- id:BUMz9EUv -->
  - Only an admin of the exact resource issues grants. A delegated grant carries the id of the admin grant that proves the issuer's authority. The owner's own admin grant has no proof and is the root anchor. <!-- id:bMhTR0Kn -->
  - Admin grants and their ancestry are permanent. A reader or writer grant is revoked by a revocation blob that names the exact grant and an admin proof for the same resource. <!-- id:nKmSPwtP -->
  - Rights are the union of every valid route. Revoking one grant does not touch another. <!-- id:sN2TNKLt -->
  - The selected Ref of a resource is the highest sequence whose author holds writer authority right now. Revoking a writer can roll the selection back, and granting again can revive the old Ref. Received bytes are never erased. <!-- id:llggYOvd -->
  - A sync, in the API, needs the reader's authority, the host's reader authority on the same resource, and an online device. A view opened at one authority revision stops at the next step when the revision changed. <!-- id:ttxoEEV_ -->
  - A public resource is readable by anyone, but public reading never implies write access or a view of the membership roster. <!-- id:xXf_4T0N -->

Placement conventions that the draft leaves open are labelled as lab conventions in the page: unique sibling names under one owner, acyclic placement, and same-owner parents. <!-- id:PFj8_MTH -->

# Step through two-peer sync <!-- id:YG54hKgT -->

Choose **Sync**, then **Load shared-DAG example**. The same editable world supplies both peers: Research lab and Field notes share content, while Private journal is readable only by Alice. You can also build replicas from any existing use case or imported world. The peer selectors choose any two principals; both need read authority on a resource before it enters their exchange. <!-- id:pYGQOahs -->

**Step** advances one RPC request, response, or local operation. **Play** advances automatically; **Previous step**, **Rewind**, and the exchange log inspect earlier storage snapshots. Replaying history does not edit the world. Rebuilding discards the simulated replicas. Runs survive page reloads while the app is running, but are intentionally not persisted across app restarts. <!-- id:ZQ3nyEbq -->

The two DAGs show each peer's retained blocks and pending frontier. Solid edges are content containment; dashed amber edges are authority proofs. Selecting a resource filters the graph, and selecting a block shows its envelope. **Open in world editor** returns to the existing inspector for its resource, grant, Ref, change or revocation. Control evidence, active content and relevant tables light up at each step. This is an observer view: both local stores are visible to you, but only the shown RPC payload crosses the simulated connection. <!-- id:X4boRpPN -->

There are four initial layouts: A has the content and B has only control evidence; B already has a complete subtree; B has a head but lacks its content; or resources are split between peers. The last layout exercises transfers in both directions. Identical heads do not imply complete replication. Private scopes, their inventory and unrelated membership evidence are excluded from the wire trace. <!-- id:HvTL-i7z -->

The machine authenticates, exchanges scoped control evidence, opens revision-bound scopes, compares resource heads, walks containment edges, fetches missing blocks, marks completeness bottom-up, commits, and acknowledges. Resource-head comparison stands in for RBSR; it does not implement its range messages. Any edit to the fixture invalidates an active run before the next disclosure, including between request and response. An offline device also stops the run. Rebuild to refresh the world and control evidence. <!-- id:C56uoUub -->

The SQL panel exposes independently mutated in-memory tables and illustrative SQL, with proposed schemas and indexes: `blobs`, `edges`, `authority_cache`, `resource_heads`, `complete`, `frontier`, and `receipts`. Rows change only when an operation executes, not while its request is in flight. Authority caches are resource-scoped. Completeness is keyed by immutable block and traversal rules, with pinned closures during a run. No per-resource enumeration of every blob is used for reconciliation, and no global `HAS(CID)` endpoint is exposed. This models table behavior; it does not execute SQL or benchmark indexing performance. <!-- id:WZTEmW9Z -->

Snapshot payloads are split into paragraph blocks and balanced manifests solely for the experiment. Their SHA-256 identities derive from their serialized bytes, so identical supplied paragraphs share storage across resources; they are not production CIDs. Refs carry links to those payloads rather than repeating the inline content. Existing same-resource change dependencies are followed. Missing dependencies, cycles, and cross-resource change references remain unresolved and prevent a complete receipt. Redirect targets are references, not containment, and do not grant access. Imported content must be supplied as bytes in the fixture; merely adding a private CID cannot import its data. General signed admission/import certificates remain a protocol design question. <!-- id:Bdpu2K9J -->

**Reuse complete subtrees** skips an entire cached closure, even when it came from a different resource. The saved requests can reveal possession. **Uniform transfer · hide reuse** fetches the full offered closure regardless of local completeness, while deduplicating disk storage. It illustrates the bandwidth tradeoff; it does not claim protection against timing analysis or implement padding or encryption. <!-- id:ORpcyVZ_ -->

The API actions are `syncLabBegin` with `left`, `right`, `profile` (`cold`, `shared`, `partial`, or `split`) and `privacy` (`deduplicate` or `scoped`); `syncLabStep`; and `syncLabSeek` with a previously visited numeric `index`. They operate on the same session as the existing editor. The earlier `syncBegin` API remains available for compatibility. <!-- id:2hH_L3DQ -->

## Reading the two graphs

The Sync view starts with one resource. Content and Permissions are separate layers. Read a content arrow as “needs this”: the selected version points to manifest packing lists, which point to chunks of actual content. A shared child appears once per peer. Permission arrows instead point from a grant to its required proof and root policy.

Both peers use the same positions, computed from the observer catalog. Solid cards hold verified bytes; checks mark a complete containment subtree; dashed outlines are unheld observer hints, while “To fetch” indicates discovered frontier work. Outlines never enter RPC payloads. Unheld private content is suppressed for peers without current read authority. “Follow this step” selects the relevant resource and layer; manually selecting either turns following off.

“Help me read this” opens four short lessons. Selecting a block reveals its meaning, immediate dependencies and optional stored envelope. Every block has a direct Seed definition link. Current messages, trace rows, table explanations, column concepts and the concept index link to stable block anchors in Starlight’s published HM26 documents. The shared catalog is `static/sync-concepts.mjs`.

The [graph-reading guide](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/syncing-guide#sy83ca68), [RPC explanations](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/peer-rpc#sy8e1941), and [SQL explanations](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-index#sy4ec7c5) distinguish this experiment from the earlier tentative `ReconcileBlobs` contract. `ReconcileHeads` is an alternative to evaluate; `FetchBlock` teaches the proposed `FetchBlobs` flow one block at a time; `Ack` is illustrative; walk and Commit are local operations.

# The API <!-- id:0QtWRj8i -->

The API is JSON over HTTP on the desktop app's API port. It is the same server that serves `/api/<Key>` for the [Seed API](../build/web-api.md), so it refuses cross-site browser requests the same way. <!-- id:avkVb9Vm -->

<!-- id:E1t4zw9j -->
| Request <!-- col:Tu_2epRb --> | What it does <!-- col:EmcIC3UF --> <!-- id:U_lQ0ta1 --> |
| --- | --- |
| `GET /api/playground` | The snapshot: the world, the derived facts, the loaded use case, the open sync run, undo availability, the use cases. <!-- id:um4X53it --> |
| `POST /api/playground/actions` | One action as a JSON object with a `type`. The reply carries the new snapshot, a message for the user, and a hint about what to select next. <!-- id:-KB9Kd6E --> |
| `GET /api/playground/export` | The world as a downloadable JSON file. <!-- id:iIIqcWQ0 --> |
| `GET /hm/playground/` | The page and its assets. <!-- id:LiXUsfMD --> |

The snapshot's `state` is the world as stored: `keys`, `resources`, `grants`, `statements`, `changes`, `revocations`, `devices`, `outbox`, plus the `revision` and `serial` counters. Its `derived` part is what the API computed from it and what the page renders: a path, selected Ref and rendition per resource, a status per grant, revocation and Ref, an access matrix for every key and resource with the grant ids that justify it, the first admin route per key and resource, the flat ledger of records, and the counters shown at the top of the page. The browser never evaluates authority itself. The snapshot also carries `syncLab`, the reversible two-peer experiment described below. <!-- id:1xcMWSQN -->

Actions and their fields: <!-- id:fElE-A1m -->

<!-- id:WFK70eBn -->
| `type` <!-- col:D27H3LJP --> | Fields <!-- col:TzC9J2jX --> | Effect <!-- col:9gc3fM6z --> <!-- id:MvAWz6hQ --> |
| --- | --- | --- |
| `issue` | `actor`, `to`, `resource`, `role` | Issue a grant with the actor's admin proof. <!-- id:4bpF4yBT --> |
| `revoke` | `actor`, `grant` | Revoke a reader or writer grant as a same-scope admin. <!-- id:wlm1Xy61 --> |
| `revokeRoutes` | `key`, `resource` | Revoke every reader and writer route of a key on a resource, as the owner. <!-- id:wxENfqUp --> |
| `publish` | `author`, `resource`, `text` | Sign a new snapshot Ref and queue an offer. <!-- id:WiYTqClk --> |
| `deliver` | `author` | Deliver the author's queued offers; only `INDEXED` is a receipt. <!-- id:Tov94NGC --> |
| `createKey` | `name`, `note` | Add a simulated key with an online device. <!-- id:bYXZwkq0 --> |
| `saveObject` | `objectType`, `id`, `data` | Create or edit a `key`, `resource`, `policy`, `capability`, `revocation`, `change` or a node kind. A capability with an `id` is reissued. A capability or revocation without a `proof` gets the signer's admin grant on the resource. A Ref without a `seq` follows the last one. <!-- id:04oVNDra --> |
| `duplicate` | `objectType`, `id` | Copy an object. A resource copy gets its own root anchor and Ref. <!-- id:ls1Qeh7c --> |
| `remove` | `objectType`, `id` | Remove an object. Removing a key or resource removes what depends on it. <!-- id:EmZy8-Vx --> |
| `setDevice` | `key`, `online`, `follow` | Toggle a device. <!-- id:NMpKPvLT --> |
| `reset` |  | Load the starting world. <!-- id:QMBs9qSF --> |
| `loadScenario` | `id` | Load one of the use cases. The snapshot's `preset` says which one is loaded and whether it changed since. <!-- id:BshcWzzr --> |
| `undo`, `redo` |  | Walk the history. Fifty steps are kept. <!-- id:9c70sTRt --> |
| `import` | `state` | Replace the world with a validated export. <!-- id:sDS9FFJG --> |
| `syncBegin`, `syncStep`, `syncReset` | `key`, `resource` for begin | Run a reader's sync through the host one step at a time. The page has no control for this; it is reachable from the API and the tests. <!-- id:b2b8UuNA --> |

Every action checks that the world is still well formed before it is kept: ids are unique, fields have the right types, and at least one key and one resource remain. It does not check that blobs make sense. A grant with a wrong proof, a resource under another owner's tree or a Ref signed by a key that does not exist is stored, and `derived.problems` lists why each such blob cannot be evaluated, by id. A Ref with problems is never selected. A rejected action answers 400 with an `error` and leaves the world as it was. The world file is written atomically after every accepted action. <!-- id:8x5-BYuy -->

An example from the command line: <!-- id:liPVZJml -->

```bash <!-- id:Z8SiMSrO -->
curl -s http://localhost:58004/api/playground | jq '.snapshot.derived.access.bob.lab'
curl -s -X POST http://localhost:58004/api/playground/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"revoke","actor":"alice","grant":"g4"}' | jq '.message'
```

# Where the code is <!-- id:fA_NbJ0L -->

Everything is under `frontend/apps/desktop/src/playground/`. <!-- id:ZWRk0m0x -->
  - `model.ts`: the evaluator. Grant validity, access, selection, issue, revoke, publish, sync steps, placement, renditions, the problem lists for blobs that cannot be evaluated, and the shape check of an untrusted world. <!-- id:eMXRpJKQ -->
  - `sync-lab.ts`: independent peer stores, immutable graph, protocol steps, SQL table simulation and reversible snapshots. <!-- id:gIt8Yr46 -->
  - `static/sync.mjs`: the integrated Sync view, DAGs, playback, exchange log and table inspector. <!-- id:r5nJOsnr -->
  - `records.ts`: the flat ledger with references. <!-- id:nYOURVF4 -->
  - `derive.ts`: the derived view the snapshot carries. <!-- id:RLwXpQxi -->
  - `session.ts`: the session: actions, undo and redo, the sync run, the use cases, and persistence through a storage interface. <!-- id:O1IGqt_b -->
  - `api.ts`: the HTTP handler, pure over a request shape, and the file storage. <!-- id:pIivDw_f -->
  - `assets.ts` and `static/`: the page, one script plus the blob editor. Vite inlines the static files into the main-process bundle, so nothing is copied at packaging time. <!-- id:_xs3xNVV -->

The handler is mounted in `app-http-server.ts`, and the menu item is in `app-menu.ts`. The tests are `src/__tests__/playground-model.test.ts` and `src/__tests__/playground-api.test.ts`. Run them with: <!-- id:pF6b59xG -->

```bash <!-- id:7UCY63nW -->
cd frontend/apps/desktop && pnpm exec vitest run src/__tests__/playground-
```

# What it does not prove <!-- id:RwFQaz2G -->

The playground is a model of a policy, not an implementation of a protocol. Signatures are names, CIDs are labels, and the legacy sync API uses one host. The Sync view models two independent replicas. It does not execute change DAGs, so a changes node renders as unsupported even when its heads resolve. It does not resolve redirects or revive tombstones natively, because the draft leaves those open; it only shows what is selected and evaluates the target on its own. It does not model encryption, conflicting concurrent Ref reconciliation, or crash recovery. The Sync view converges supplied selected content between two peers; it does not implement a production sync protocol. When the daemon implements HM26, this page should be rebuilt on the real evaluator or retired. Its purpose is to make the open questions in the [authority model](../protocol/hm26-authority.md) concrete enough to argue about. <!-- id:b783Spky -->

# See also <!-- id:9bsUAT6T -->

- [The HM26 authority model](../protocol/hm26-authority.md), the policy it simulates. <!-- id:b-6UkApc -->
- [The HM26 space](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26), the published schemas and design notes the blobs here follow. <!-- id:JVDsXtSt -->
- [Where this is going](../protocol/roadmap.md), the HM26 redesign in context. <!-- id:M42rIUdW -->
- [Permissions](../protocol/permissions.md), what the daemon does today. <!-- id:jB24UOPH -->
- [The desktop app](./desktop.md), the process that serves it. <!-- id:LybFKRA4 -->
