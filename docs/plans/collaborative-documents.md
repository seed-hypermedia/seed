# Collaborative Documents ("Rooms")

Status: Plan. No code yet.

## Summary

Let several Seed users edit the same document in realtime, keep attribution,
and publish a single new version with co-authors. Delivered in two independent
tracks:

- **Track A — Co-authors on publish.** Lets any publisher attach co-authors to
  the published blob, independent of any realtime feature. Useful on its own
  ("I'm in a meeting, I want to credit the people in the room"), and becomes
  the attribution sink the collab feature plugs into.
- **Track B — Collaborative rooms.** Realtime multi-user editing sessions on
  top of the existing Yjs stack. Phase 1 is relay-only desktop; later phases
  add direct p2p, web clients, LAN-only rooms, and per-character authorship.

Track A can ship before Track B and be used standalone.

---

## Design decisions (locked)

| Area | Decision |
|---|---|
| Track B Phase 1 clients | Desktop only (Electron) |
| Track B Phase 1 transport | Site daemon relay only (libp2p direct in Phase 2) |
| Access control | Unguessable share link = capability; optional password |
| Room state | All connected peers hold a full replica |
| Presence | Live cursors, selections, participant avatars |
| Publish model | Shared draft attached to an existing document |
| Initial publish rights | Room creator |
| Owner leaves | Earliest-joined remaining peer becomes owner (tie-break: lower deviceID) |
| Last peer leaves | Room collapses into that peer's local draft |
| Local draft on same doc | Must be published/discarded before a room can start or be joined |
| Account switch during a session | Treated as leave + rejoin; both accountIDs attributed |
| Leave but keep editing | Supported: session state is persisted as a local draft on that peer |
| Invites | Share link, copy-paste, plus notification-service deep-link invite |

## Non-goals

- Web/browser participation (Phase 3+)
- Per-character / Google-Docs-style attribution (Phase 2+, but designed-in)
- Typing indicators
- Offline edits merging while the owner is offline and no peers remain
- Mobile clients

---

## What we reuse

- `@shm/editor` already depends on `yjs`, `y-prosemirror`, `y-protocols`,
  `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`.
  The CRDT + cursor UI is installed but not instantiated.
- `backend/hmnet` gives us authenticated libp2p identities (used in Track B
  Phase 2).
- The draft/publish state machine described in
  `docs/document-lifecycle-explained.md` — we extend it, not replace it.
- The existing site daemon — it gets a new websocket endpoint.
- The existing notification service — it gets a new notification type.

---

# Track A — Co-authors on publish

Small, standalone, proto-touching. Ship first.

## A1. Data model

- Extend the document change/version blob with `repeated string co_author_account_id`.
  Field lives in `proto/documents/v*/documents.proto`.
- Co-authors are **not** signers. Only the publisher signs. Co-authors are
  descriptive metadata rendered in the UI.

## A2. UI

- In the Publish dialog, add a "Co-authors" selector that searches known
  accounts (uses the existing account picker from comments/mentions).
- Document header renders the list of co-authors alongside the author, with a
  tooltip explaining the distinction.

## A3. Backend

- Publish RPC accepts the optional `co_author_account_ids`. Backend writes
  them into the version blob unchanged.
- Indexing: extend the existing documents indexer so queries like "documents
  where I'm a co-author" become possible (mirrors existing author-based
  filters).

## A4. Deliverable

- Proto change + backend write path + indexer update + publish-dialog UI.
- No realtime work, no new services, no new protocols.

---

# Track B — Collaborative rooms

## B1. User flow

1. User A opens doc `hm://…/foo` and picks **"Start collaborative session"**.
   - Blocked if A has an unpublished local draft on `foo`.
2. Seed creates a room: new `Y.Doc`, seeded from the latest published version
   of `foo`. Mints a **capability token**. Optionally A sets a password.
3. A copies a share URL and/or sends an invite via the notification service.
4. User B opens the URL in their desktop app.
   - Blocked if B has a local draft on `foo`.
   - If the room has a password, B is prompted for it.
5. Both apps connect to the site relay, subscribe to the room, and sync the
   `Y.Doc`. Cursors + avatars appear.
6. Either user edits; both see live updates.
7. Owner (A) clicks **Publish**. A new version of `foo` is signed by A, with
   B (and anyone else who was in the session) listed as co-authors via the
   Track A mechanism. Room closes.

Side flows:
- **Transfer ownership** — A explicitly hands ownership to B (both online).
- **A disconnects** — succession rule runs; B becomes owner.
- **Leave and keep editing locally** — Yjs state is converted to our block
  tree and saved as a local draft. The user exits the room. Others continue.
- **Last peer leaves** — same as above, but the room no longer exists.
- **Account switch mid-session** — treated as leave + rejoin under the new
  account.

## B2. Architecture (Phase 1, relay-only)

```
 Desktop A                             Desktop B
 ┌────────────┐                       ┌────────────┐
 │  Editor    │                       │  Editor    │
 │  Y.Doc     │◄─── Yjs sync + ─────►│  Y.Doc     │
 │  + cursors │     awareness         │  + cursors │
 └─────┬──────┘                       └──────┬─────┘
       │  CollabProvider                     │
       │  (WebSocket)                        │
       ▼                                     ▼
       └──────────► Site Relay ◄─────────────┘
                   (/collab/:roomID
                    dumb message mux,
                    auth by capability)
```

## B3. Data model

- **Room ID** — 128-bit random.
- **Capability token** — URL fragment:
  `https://<site>/collab/<roomID>#<secret>[.<pwSalt>]`.
  The `secret` is a 128-bit shared key. If the room is password-protected, the
  URL carries only a password salt, and the relay requires
  `HMAC(secret, password)` on connect — the password is never in the URL.
- **Shared draft** — `Y.Doc` whose `XmlFragment` maps to our BlockNote schema
  via `y-prosemirror`. Initial contents: snapshot of the published doc.
- **Awareness state per peer** — `{ accountID, deviceID, cursor, selection,
  color, displayName, joinTime, isOwner }`. Signed with the peer's device key
  so another peer can't impersonate.
- **Ownership** — stored in a dedicated `Y.Map` key `owner` holding `deviceID`.
  Updates enforced client-side by checking signature of the awareness that
  proposed the change.
- **Co-author log** — each peer locally appends `(accountID, timestamp)` for
  every Yjs update it produces. The log is not part of the Yjs doc; it's
  collected at publish time from everyone still in the room, unioned, and
  passed to the Track A `co_author_account_ids` list. Peers who leave send a
  final log snapshot over the relay before disconnecting.

## B4. Site relay

- New service in the site daemon:
  `GET /collab/:roomID` upgraded to WebSocket.
- Per-room in-memory state: `{ connections[], passwordHash?, lastActivity }`.
- Protocol: length-prefixed frames. Two frame types:
  - `sync` — raw y-protocols sync bytes, passed through.
  - `awareness` — raw y-protocols awareness bytes, passed through.
  - A control namespace carried inside `awareness` covers owner transfers and
    co-author-log snapshots so we don't invent a third wire type.
- Auth on connect:
  - Client sends the capability `secret` (and, if password-protected,
    `HMAC(secret, password)`). Relay verifies the MAC using the `pwSalt` from
    the URL.
  - No Seed identity check at the relay — link-is-the-capability.
  - Identity of the connecting peer is carried inside signed awareness frames
    and verified by other clients, not by the relay.
- Relay never parses payloads, never persists them. It fans out.
- GC: room evicted from memory after N minutes of silence with no connections.
- Rate-limit per connection and per room.
- Lives in `backend/daemon/collab-relay/` (or co-located with hmnet if that
  reads more naturally during implementation).

## B5. Editor integration

New module `frontend/packages/editor/src/collab/`:

- `CollabProvider` — transport-agnostic y-protocols provider. Accepts an
  injected `Transport` with `send(bytes)`, `onMessage(cb)`, `close()`.
- `RelayTransport` — thin WebSocket implementation.
- Wire `@tiptap/extension-collaboration` and `collaboration-cursor` into
  `document-editor.tsx` behind a `collab?: CollabSession` prop. When set, the
  editor binds to the Yjs doc instead of the normal draft store.
- Cursor color derived deterministically from `accountID`. Display name +
  avatar read from the existing account profile.

## B6. Lifecycle changes

Extend the machine in `docs/document-lifecycle-explained.md`:

```
Viewing ─► CollabEditing ─► Publishing ─► Viewing
              ▲    │
              │    ├─► LeaveAndKeepLocal ─► Editing
              │    └─► Leaving (discard local copy; others continue)
              │
   blocked if an unpublished local draft exists on this doc
```

- Entering `CollabEditing` blocks when an existing local draft is present.
- Exiting via `LeaveAndKeepLocal` serializes the current Yjs state through
  y-prosemirror into our block tree and creates/updates a local draft.
- Owner disconnect runs the succession rule and hands ownership to the peer
  with the earliest `joinTime` in awareness (tie-break: lowest deviceID).
- Crash recovery: each peer periodically writes `Y.encodeStateAsUpdate(doc)`
  to a local file keyed by `roomID`, re-applied on reconnect.

## B7. Security

- Capability `secret` is 128 bits; never logged; fragment (`#`) so it never
  reaches the relay's HTTP logs.
- Password is never on the wire or in the URL; only its salt is in the URL,
  and the relay receives `HMAC(secret, password)`.
- Relay must not log frame payloads.
- Signed awareness: peers sign awareness state with their Seed device key;
  other clients reject awareness whose claimed `accountID` doesn't match the
  verified signature. This is the one place we care about identity — it's
  what makes attribution trustworthy.
- Version mismatch: if a peer's editor schema is incompatible, refuse to join
  with a clear upgrade message.

## B8. Invites via notification service

- New notification type `collab_invite` with payload
  `{ roomURL, inviterAccountID, docId, docTitle }`.
- Publisher UI: "Invite to collaborate" action on the room, account picker
  identical to Track A's co-author picker.
- Recipient: notification opens the desktop app to the join flow, prompts for
  password if present.
- Respects existing per-account notification preferences.

## B9. Phase 1 milestones

| # | Deliverable | Size |
|---|---|---|
| 1 | `CollabProvider` + in-process transport; two editor panes sharing a Y.Doc as a dev harness | S |
| 2 | Site relay service + `RelayTransport` end-to-end between two desktops | M |
| 3 | Capability link mint + parse + join flow UI; "Start collaborative session" entry point | S |
| 4 | Presence: signed awareness, cursors, selections, participant avatars | M |
| 5 | Lifecycle integration: block-on-local-draft, CollabEditing branch, LeaveAndKeepLocal, crash snapshot | M |
| 6 | Ownership + succession + explicit transfer | S |
| 7 | Publish path hooking into Track A (co-author log aggregation and submit) | S |
| 8 | Password-protected rooms | S |
| 9 | Notification-service invites | S |
| 10 | Hardening: rate limiting, version mismatch UX, relay GC, docs | S |

Track A must land before milestone 7.

---

# Future phases

## Phase 2 — Direct p2p transport

- New libp2p protocol `/hypermedia/collab/0.1.0` in `backend/hmnet/collab/`.
  One bidirectional stream per (peer, room), framed messages carry raw
  y-protocols bytes.
- Discovery: owner publishes a DHT provider record `(roomID → peerID)`;
  joiners look it up and dial directly.
- `Libp2pTransport` is a drop-in alternative to `RelayTransport`; the
  `CollabProvider` picks whichever is available, preferring direct. A health
  monitor retries libp2p periodically and can swap transport mid-session
  without resetting the Yjs doc (sync frames are idempotent).
- Relay becomes the fallback, not the default.

## Phase 3 — Web clients

- Browser `RelayTransport` (cheap — just a WebSocket).
- Browser libp2p via WebTransport or y-webrtc signaled by the site (harder;
  revisit after Phase 2 is stable).
- Web-specific UX work: login, permissions, deep links to the desktop app.

## Phase 4 — LAN-only rooms

- Flag on the capability token: "local-only".
- Discovery via libp2p mDNS (built-in). No DHT. No relay. Room cannot be
  joined from outside the LAN.
- Useful for classrooms / meetings / workshops.

## Phase 5 — Per-character attribution

- During a session, persist the `ClientID → (accountID, deviceID, timestamp)`
  map alongside the Yjs update log.
- At publish time, include a compact attribution blob keyed off the change
  blob (or carry it as an optional extension on the change blob itself — TBD
  with whoever owns the blob format).
- Readers can toggle an "author coloring" view that highlights each span by
  its originating account.
- No change to the Track A co-author list; this is additive.

---

# Open questions

- Exact wire format for the relay frame envelope (length prefix + type byte,
  or a tiny protobuf). Not blocking.
- Whether the relay ships in the existing site daemon container or its own.
  Affects deploy story more than design.
- Desktop ↔ daemon surface for the relay transport — extend existing gRPC, or
  a new ipc channel. Talk to whoever owns daemon-renderer boundaries.
- Where the co-author list should live on the version blob vs. a sibling
  attribution blob — resolve with the blob-format owners before Track A
  milestone lands.
