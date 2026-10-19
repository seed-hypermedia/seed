---
name: The HM26 playground
summary: A simulator for the tentative HM26 authority and sync design that the desktop app serves from its own API server at /hm/playground, with the model, the HTTP API, the missions, and the limits of what it proves.
---
The HM26 playground is a small game and free-play simulator for the [HM26](../protocol/roadmap.md) authority and sync design. It lives inside the [desktop app](./desktop.md): the app's own API server serves the page at `/hm/playground` and keeps the simulated world behind `/api/playground`. Keys, CIDs, signatures and peers are simulated. Nothing it does touches the [daemon](./daemon.md), a real [capability](../protocol/permissions.md) or the network. It exists so the team can try the rules in [The HM26 authority model](../protocol/hm26-authority.md) by hand before any of them ship.

# Open it

Run the desktop app in development and open the page in a browser:

```bash
./dev run-desktop
open http://localhost:58004/hm/playground/
```

A packaged app serves it on its production API port, so `http://localhost:56004/hm/playground/`. In the app, **View → HM26 Playground** opens the same URL in your default browser. The world is saved on the node after every change, in `playground/world.json` inside the app's user data folder, so the page can be closed and reopened and the experiment is still there. Undo history, mission progress and the open sync run survive a restart too. Each browser remembers only its own view state: the open tab, the selected object and the dropdown values.

# What it shows

The page has six surfaces. **Mission control** is eight puzzles with hints and experience points. Every objective is a predicate the API evaluates against the actual world, so a mission is solved only when the model says the world has the property. **World map** draws authority by exact resource scope: a circular node is a key, an angular amber ticket is an immutable capability, a green folder is a resource, and every grant reads left to right as issuer, capability, recipient inside its resource. The map has a placement view, which shows the folder tree, and a blobs view, which shows every retained statement. **Raw data ledger** is a flat list of every record with its stored JSON and links to the records it references. **Access inspector** is a read, write, admin and sync matrix for one key with the grant chain that explains each cell. **Sync observatory** steps a reader through authentication, control evidence, a frozen scope, reconciliation, fetch, commit and watch, and shows what a device retains. **Free play recipes** load nine prepared worlds: two routes with one revoke, the writer rollback, regrant and revival, an offline reader, permanent delegation, the custody boundary, child sharing, copy then cut access, and a view interrupted by a revocation.

Capabilities cannot be edited or deleted. Reissuing a capability appends a new grant with a `reissuedFrom` note and leaves the original intact. The old grant stops working only through a separate revocation, and admin grants cannot be revoked at all. The other objects, keys, resources, node statements, changes and revocations, can be edited and removed as fixture changes. Undo covers everything.

# The rules it simulates

The playground implements the first policy proposed in [The HM26 authority model](../protocol/hm26-authority.md). In short:

- A grant is scoped to one exact resource. A grant on a parent never authorizes a child, and a child grant never reaches the parent.
- Roles are reader, writer and admin. Writer includes read. Admin includes read, write, grant and revoke.
- Only an admin of the exact resource issues grants. A delegated grant carries the id of the admin grant that proves the issuer's authority. The owner's own admin grant has no proof and is the root anchor.
- Admin grants and their ancestry are permanent. A reader or writer grant is revoked by a revocation blob that names the exact grant and an admin proof for the same resource.
- Rights are the union of every valid route. Revoking one grant does not touch another.
- The selected statement of a resource is the highest sequence whose author holds writer authority right now. Revoking a writer can roll the selection back, and granting again can revive the old statement. Received bytes are never erased.
- A sync needs the reader's authority, the host's reader authority on the same resource, and an online device. A view opened at one authority revision stops at the next step when the revision changed.
- A public resource is readable by anyone, but public reading never implies write access or a view of the membership roster.

Placement conventions that the draft leaves open are labelled as lab conventions in the page: unique sibling names under one owner, acyclic placement, and same-owner parents.

# The API

The API is JSON over HTTP on the desktop app's API port. It is the same server that serves `/api/<Key>` for the [Seed API](../build/web-api.md), so it refuses cross-site browser requests the same way.

| Request | What it does |
| --- | --- |
| `GET /api/playground` | The snapshot: the world, the derived facts, the game, the open sync run, undo availability, the scenarios. |
| `POST /api/playground/actions` | One action as a JSON object with a `type`. The reply carries the new snapshot, a message for the user, and a hint about what to select next. |
| `GET /api/playground/export` | The world as a downloadable JSON file. |
| `GET /hm/playground/` | The page and its assets. |

The snapshot's `state` is the world as stored: `keys`, `resources`, `grants`, `statements`, `changes`, `revocations`, `devices`, `outbox`, plus the `revision` and `serial` counters. Its `derived` part is what the API computed from it and what the page renders: a path, selected statement and rendition per resource, a status per grant, revocation and statement, an access matrix for every key and resource with the grant ids that justify it, the first admin route per key and resource, the flat ledger of records, and the counters shown at the top of the page. The browser never evaluates authority itself.

Actions and their fields:

| `type` | Fields | Effect |
| --- | --- | --- |
| `issue` | `actor`, `to`, `resource`, `role` | Issue a grant with the actor's admin proof. |
| `revoke` | `actor`, `grant` | Revoke a reader or writer grant as a same-scope admin. |
| `revokeRoutes` | `key`, `resource` | Revoke every reader and writer route of a key on a resource, as the owner. |
| `publish` | `author`, `resource`, `text` | Sign a new snapshot statement and queue an offer. |
| `deliver` | `author` | Deliver the author's queued offers; only `INDEXED` is a receipt. |
| `createKey` | `name`, `note` | Add a simulated key with an online device. |
| `saveObject` | `objectType`, `id`, `data` | Create or edit a `key`, `resource`, `policy`, `capability`, `revocation`, `change` or a node kind. A capability with an `id` is reissued. |
| `duplicate` | `objectType`, `id` | Copy an object. A resource copy gets its own root anchor and statement. |
| `remove` | `objectType`, `id` | Remove an object. Removing a key or resource removes what depends on it. |
| `setDevice` | `key`, `online`, `follow` | Toggle a device. |
| `reset` | | Return to the starting fixture. |
| `loadScenario` | `id` | Load one of the free-play recipes. |
| `undo`, `redo` | | Walk the history. Fifty steps are kept. |
| `import` | `state` | Replace the world with a validated export. |
| `startMission`, `checkMission`, `leaveMission`, `hint` | `id` for start | Play a mission. Experience is awarded once per mission. |
| `syncBegin`, `syncStep`, `syncReset` | `key`, `resource` for begin | Run a sync one step at a time. |

Every action validates the whole world before it is kept. A rejected action answers 400 with an `error` and leaves the world as it was. The world file is written atomically after every accepted action.

An example from the command line:

```bash
curl -s http://localhost:58004/api/playground | jq '.snapshot.derived.access.bob.lab'
curl -s -X POST http://localhost:58004/api/playground/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"revoke","actor":"alice","grant":"g4"}' | jq '.message'
```

# Where the code is

Everything is under `frontend/apps/desktop/src/playground/`.

- `model.ts`: the evaluator. Grant validity, access, selection, issue, revoke, publish, sync steps, placement, renditions and the validation of an untrusted world.
- `quests.ts`: the eight missions as fixtures and predicates.
- `records.ts`: the flat ledger with references.
- `derive.ts`: the derived view the snapshot carries.
- `session.ts`: the session: actions, undo and redo, the mission game, the sync run, the free-play recipes, and persistence through a storage interface.
- `api.ts`: the HTTP handler, pure over a request shape, and the file storage.
- `assets.ts` and `static/`: the page. Vite inlines the static files into the main-process bundle, so nothing is copied at packaging time.

The handler is mounted in `app-http-server.ts`, and the menu item is in `app-menu.ts`. The tests are `src/__tests__/playground-model.test.ts` and `src/__tests__/playground-api.test.ts`. Run them with:

```bash
cd frontend/apps/desktop && pnpm exec vitest run src/__tests__/playground-
```

# What it does not prove

The playground is a model of a policy, not an implementation of a protocol. Signatures are names, CIDs are labels, and there is one host. It does not execute change DAGs, so a changes node renders as unsupported even when its heads resolve. It does not resolve redirects or revive tombstones natively, because the draft leaves those open; it only shows what is selected and evaluates the target on its own. It does not model encryption, multiple peers converging, or crash recovery. When the daemon implements HM26, this page should be rebuilt on the real evaluator or retired. Its purpose is to make the open questions in the [authority model](../protocol/hm26-authority.md) concrete enough to argue about.

# See also

- [The HM26 authority model](../protocol/hm26-authority.md), the policy it simulates.
- [Where this is going](../protocol/roadmap.md), the HM26 redesign in context.
- [Permissions](../protocol/permissions.md), what the daemon does today.
- [The desktop app](./desktop.md), the process that serves it.
