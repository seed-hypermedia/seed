---
name: The HM26 playground
summary: A simulator for the tentative HM26 authority and sync design that the desktop app serves from its own API server at /hm/playground, with the use cases, the editor, the HTTP API, and the limits of what it proves.
---
The HM26 playground is a simulator for the [HM26](../protocol/roadmap.md) authority and sync design. It lives inside the [desktop app](./desktop.md): the app's own API server serves the page at `/hm/playground` and keeps the simulated world behind `/api/playground`. Keys, CIDs, signatures and peers are simulated. Nothing it does touches the [daemon](./daemon.md), a real [capability](../protocol/permissions.md) or the network. It exists so the team can try the rules in [The HM26 authority model](../protocol/hm26-authority.md) by hand before any of them ship.

# Open it

Run the desktop app in development and open the page in a browser:

```bash
./dev run-desktop
open http://localhost:58004/hm/playground/
```

A packaged app serves it on its production API port, so `http://localhost:56004/hm/playground/`. In the app, **View → HM26 Playground** opens the same page inside the app window, where links to Hypermedia documents open as app routes. The world is saved on the node after every change, in `playground/world.json` inside the app's user data folder, so the page can be closed and reopened and the experiment is still there. Undo history and the loaded use case survive a restart too. Each browser remembers only its own selection and sync dropdowns.

# What it shows

The page is one view. The **use case** dropdown at the top loads a preset of blobs: two routes with one revoke, permanent delegation, child sharing, the writer rollback, regrant and revival, copy then cut access, and the full fixture with everything at once. Each use case is its own small world with only the keys, resources, grants and Refs its point needs, usually one document and two or three keys. The page says when the loaded world has been changed since.

The world column lists every key, then every resource, in one of three views. **Blobs** is the flat list: the grants, revocations and [Refs](../ref.md) on each resource, each with the status the API derived, so a grant is valid, revoked or invalid and a Ref is selected, older or ineligible. A Ref here is what it is in the protocol, a signed claim about what a resource currently shows, with one simplification: a snapshot Ref carries its content inline instead of naming change heads, so a world can be read without a change DAG. Tombstone and redirect Refs mean what they mean in the protocol, and the changes kinds name heads the way a version Ref does. **Authority** is a graph: resources along the top, keys along the bottom, and every grant as a ticket between them with a line in from its issuer, an arrow out to its recipient and a dotted line up to the one resource it covers. A revoked grant is dashed and carries its revocation. The add-grant button opens the editor on the selected resource. **Placement** draws the folder tree, with the selected Ref under each resource and buttons to add a child or a Ref. Nesting is placement only and grants nothing. Selecting anything in any view shows its details on the right: its fields, the facts derived from it, and a read, write, admin and sync table for the keys on that resource, or for that key on every resource. Selecting a row of the table names the grants that explain it. A blob the rules cannot evaluate, such as a grant whose proof is held by someone else or a resource placed inside another owner's tree, is marked invalid in every view, and its details list what is wrong. Every blob's details and editor link the page in the [HM26 space](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26) that defines it: a grant to [capability-admin](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability-admin) or [capability-revocable](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/capability-revocable), a revocation to [revocation](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/revocation), a resource to [resource](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource), and a Ref to the page for its kind, such as [resource-state](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-state) or [resource-tombstone](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/resource-tombstone).

Adding a blob opens a short form with one blob type at a time: a key, a resource, a capability, a revocation, a Ref or a resource policy. The form asks only for what the model needs, and it does not refuse a wrong blob: whatever you save is stored, and the page shows what the rules make of it. Proofs come from the admin grant the signer holds on the resource, and sequence numbers follow the last Ref. Capabilities cannot be edited or deleted. Reissuing a capability appends a new grant with a `reissuedFrom` note and leaves the original intact. The old grant stops working only through a separate revocation, and admin grants cannot be revoked at all. Keys, resources, Refs and revocations can be edited and removed as fixture changes. Undo covers everything.

# The rules it simulates

The playground implements the first policy proposed in [The HM26 authority model](../protocol/hm26-authority.md). In short:

- A grant is scoped to one exact resource. A grant on a parent never authorizes a child, and a child grant never reaches the parent.
- Roles are reader, writer and admin. Writer includes read. Admin includes read, write, grant and revoke.
- Only an admin of the exact resource issues grants. A delegated grant carries the id of the admin grant that proves the issuer's authority. The owner's own admin grant has no proof and is the root anchor.
- Admin grants and their ancestry are permanent. A reader or writer grant is revoked by a revocation blob that names the exact grant and an admin proof for the same resource.
- Rights are the union of every valid route. Revoking one grant does not touch another.
- The selected Ref of a resource is the highest sequence whose author holds writer authority right now. Revoking a writer can roll the selection back, and granting again can revive the old Ref. Received bytes are never erased.
- A sync, in the API, needs the reader's authority, the host's reader authority on the same resource, and an online device. A view opened at one authority revision stops at the next step when the revision changed.
- A public resource is readable by anyone, but public reading never implies write access or a view of the membership roster.

Placement conventions that the draft leaves open are labelled as lab conventions in the page: unique sibling names under one owner, acyclic placement, and same-owner parents.

# The API

The API is JSON over HTTP on the desktop app's API port. It is the same server that serves `/api/<Key>` for the [Seed API](../build/web-api.md), so it refuses cross-site browser requests the same way.

| Request | What it does |
| --- | --- |
| `GET /api/playground` | The snapshot: the world, the derived facts, the loaded use case, the open sync run, undo availability, the use cases. |
| `POST /api/playground/actions` | One action as a JSON object with a `type`. The reply carries the new snapshot, a message for the user, and a hint about what to select next. |
| `GET /api/playground/export` | The world as a downloadable JSON file. |
| `GET /hm/playground/` | The page and its assets. |

The snapshot's `state` is the world as stored: `keys`, `resources`, `grants`, `statements`, `changes`, `revocations`, `devices`, `outbox`, plus the `revision` and `serial` counters. Its `derived` part is what the API computed from it and what the page renders: a path, selected Ref and rendition per resource, a status per grant, revocation and Ref, an access matrix for every key and resource with the grant ids that justify it, the first admin route per key and resource, the flat ledger of records, and the counters shown at the top of the page. The browser never evaluates authority itself.

Actions and their fields:

| `type` | Fields | Effect |
| --- | --- | --- |
| `issue` | `actor`, `to`, `resource`, `role` | Issue a grant with the actor's admin proof. |
| `revoke` | `actor`, `grant` | Revoke a reader or writer grant as a same-scope admin. |
| `revokeRoutes` | `key`, `resource` | Revoke every reader and writer route of a key on a resource, as the owner. |
| `publish` | `author`, `resource`, `text` | Sign a new snapshot Ref and queue an offer. |
| `deliver` | `author` | Deliver the author's queued offers; only `INDEXED` is a receipt. |
| `createKey` | `name`, `note` | Add a simulated key with an online device. |
| `saveObject` | `objectType`, `id`, `data` | Create or edit a `key`, `resource`, `policy`, `capability`, `revocation`, `change` or a node kind. A capability with an `id` is reissued. A capability or revocation without a `proof` gets the signer's admin grant on the resource. A Ref without a `seq` follows the last one. |
| `duplicate` | `objectType`, `id` | Copy an object. A resource copy gets its own root anchor and Ref. |
| `remove` | `objectType`, `id` | Remove an object. Removing a key or resource removes what depends on it. |
| `setDevice` | `key`, `online`, `follow` | Toggle a device. |
| `reset` | | Load the starting world. |
| `loadScenario` | `id` | Load one of the use cases. The snapshot's `preset` says which one is loaded and whether it changed since. |
| `undo`, `redo` | | Walk the history. Fifty steps are kept. |
| `import` | `state` | Replace the world with a validated export. |
| `syncBegin`, `syncStep`, `syncReset` | `key`, `resource` for begin | Run a reader's sync through the host one step at a time. The page has no control for this; it is reachable from the API and the tests. |

Every action checks that the world is still well formed before it is kept: ids are unique, fields have the right types, and at least one key and one resource remain. It does not check that blobs make sense. A grant with a wrong proof, a resource under another owner's tree or a Ref signed by a key that does not exist is stored, and `derived.problems` lists why each such blob cannot be evaluated, by id. A Ref with problems is never selected. A rejected action answers 400 with an `error` and leaves the world as it was. The world file is written atomically after every accepted action.

An example from the command line:

```bash
curl -s http://localhost:58004/api/playground | jq '.snapshot.derived.access.bob.lab'
curl -s -X POST http://localhost:58004/api/playground/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"revoke","actor":"alice","grant":"g4"}' | jq '.message'
```

# Where the code is

Everything is under `frontend/apps/desktop/src/playground/`.

- `model.ts`: the evaluator. Grant validity, access, selection, issue, revoke, publish, sync steps, placement, renditions, the problem lists for blobs that cannot be evaluated, and the shape check of an untrusted world.
- `records.ts`: the flat ledger with references.
- `derive.ts`: the derived view the snapshot carries.
- `session.ts`: the session: actions, undo and redo, the sync run, the use cases, and persistence through a storage interface.
- `api.ts`: the HTTP handler, pure over a request shape, and the file storage.
- `assets.ts` and `static/`: the page, one script plus the blob editor. Vite inlines the static files into the main-process bundle, so nothing is copied at packaging time.

The handler is mounted in `app-http-server.ts`, and the menu item is in `app-menu.ts`. The tests are `src/__tests__/playground-model.test.ts` and `src/__tests__/playground-api.test.ts`. Run them with:

```bash
cd frontend/apps/desktop && pnpm exec vitest run src/__tests__/playground-
```

# What it does not prove

The playground is a model of a policy, not an implementation of a protocol. Signatures are names, CIDs are labels, and there is one host. It does not execute change DAGs, so a changes node renders as unsupported even when its heads resolve. It does not resolve redirects or revive tombstones natively, because the draft leaves those open; it only shows what is selected and evaluates the target on its own. It does not model encryption, multiple peers converging, or crash recovery. When the daemon implements HM26, this page should be rebuilt on the real evaluator or retired. Its purpose is to make the open questions in the [authority model](../protocol/hm26-authority.md) concrete enough to argue about.

# See also

- [The HM26 authority model](../protocol/hm26-authority.md), the policy it simulates.
- [The HM26 space](https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26), the published schemas and design notes the blobs here follow.
- [Where this is going](../protocol/roadmap.md), the HM26 redesign in context.
- [Permissions](../protocol/permissions.md), what the daemon does today.
- [The desktop app](./desktop.md), the process that serves it.
