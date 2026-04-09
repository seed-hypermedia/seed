# Desktop Notifications Architecture

This document describes the current desktop implementation. The server-side source of truth is:

- notify service:
  [`../../notify/app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md`](../../notify/app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md)

The important current fact is that desktop no longer has three separate notification engines. It now has one shared
local notification store and sync engine:

- [`./app-notifications.ts`](./app-notifications.ts)

The old wrapper files still exist, but they are mostly thin TRPC facades over that unified store:

- [`./app-notification-config.ts`](./app-notification-config.ts)
- [`./app-notification-read-state.ts`](./app-notification-read-state.ts)
- [`./app-notification-inbox.ts`](./app-notification-inbox.ts)

## High-Level Model

Desktop is intentionally more stateful than web.

It keeps:

- a local optimistic copy of the full notification snapshot
- a queue of pending actions that have not synced yet
- sync metadata such as `lastSyncAtMs` and `lastSyncError`

The source file to understand first is:

- [`./app-notifications.ts`](./app-notifications.ts)

That file now owns:

- local inbox cache
- local read state
- local config state
- pending action queue
- background sync
- daemon-backed request signing

## Local Store Shape

The persisted desktop store lives in Electron app storage and is keyed by:

- `NotificationsState-v001`

Code:

- [`loadStore()` and `writeStore()` in `./app-notifications.ts`](./app-notifications.ts)

Per account, desktop stores:

- `snapshot`
- `pendingActions`
- `lastSyncAtMs`
- `lastSyncError`

The `snapshot` shape is the shared canonical notification state model from:

- [`../../../packages/shared/src/models/notification-state.ts`](../../../packages/shared/src/models/notification-state.ts)

## Signing Model

Desktop does not sign in the renderer. It asks the daemon to sign.

Signing bridge:

- [`buildDesktopSigner(...)` in `./app-notifications.ts`](./app-notifications.ts)

That calls:

- [`grpcClient.daemon.signData(...)`](./app-grpc.ts)
- daemon implementation:
  [`../../../../backend/api/daemon/v1alpha/daemon.go`](../../../../backend/api/daemon/v1alpha/daemon.go)

The signed transport itself is shared with web:

- [`../../../packages/shared/src/models/notification-service.ts`](../../../packages/shared/src/models/notification-service.ts)

So desktop and web now hit the same notify-service route:

- [`../../notify/app/routes/hm.api.notifications.tsx`](../../notify/app/routes/hm.api.notifications.tsx)

## Sync Model

Desktop sync is local-first.

When the user changes notification state:

1. desktop reduces the change locally
2. desktop queues a `QueuedNotificationAction`
3. desktop invalidates local queries
4. desktop schedules a sync

Relevant code:

- local reducer application: [`reduceNotificationState(...)`](../../../packages/shared/src/models/notification-state.ts)
- queuing/scheduling: [`enqueueAction(...)` and `scheduleSync(...)` in `./app-notifications.ts`](./app-notifications.ts)

### Sync algorithm

The actual sync is implemented in:

- [`runSync(...)`](./app-notifications.ts)

Flow:

1. resolve notify host
2. build a daemon-backed signer
3. fetch the canonical remote snapshot with `getNotificationState(...)`
4. replay local pending actions on top of the fetched snapshot
5. if there are pending actions, send `applyNotificationActions(...)`
6. drop applied actions from the pending queue
7. keep any still-unapplied actions and re-reduce them onto the returned snapshot

This is simpler than the older read-state-specific merge logic because inbox, config, and read state now travel together
as one snapshot.

## Background Lifecycle

The background sync loop is started through:

- [`startNotificationReadBackgroundSync()`](./app-notification-read-state.ts)
- [`startNotificationInboxBackgroundIngestor()`](./app-notification-inbox.ts)

But both now delegate to:

- [`startNotificationBackgroundSync()` in `./app-notifications.ts`](./app-notifications.ts)

That loop:

- schedules sync every 30 seconds
- syncs all known accounts
- also supports immediate sync on demand

Host changes are handled by:

- [`handleNotifyServiceHostChanged(...)`](./app-notifications.ts)

## Inbox Flow

The desktop inbox UI does not fetch the server directly. It reads the local desktop store.

Renderer hook:

- [`./models/notification-inbox.ts`](./models/notification-inbox.ts)

TRPC wrapper:

- [`./app-notification-inbox.ts`](./app-notification-inbox.ts)

Actual data source:

- [`getLocalNotificationInbox(...)` in `./app-notifications.ts`](./app-notifications.ts)

So the inbox seen by the renderer is:

- whatever was last synced from the notify service
- plus any local optimistic changes already reduced into the snapshot

## Read-State Flow

Desktop read-state mutations are also local-first.

Renderer hooks:

- [`./models/notification-read-state.ts`](./models/notification-read-state.ts)

TRPC wrapper:

- [`./app-notification-read-state.ts`](./app-notification-read-state.ts)

Actual implementation:

- [`markNotificationEventRead(...)`](./app-notifications.ts)
- [`markNotificationEventUnread(...)`](./app-notifications.ts)
- [`markAllNotificationsRead(...)`](./app-notifications.ts)

Those functions queue shared notification actions rather than implementing their own read-state protocol.

Read semantics still come from shared pure logic:

- [`../../../packages/shared/src/models/notification-read-logic.ts`](../../../packages/shared/src/models/notification-read-logic.ts)

## Config Flow

Desktop notification email settings are also now just actions against the same local store.

Renderer hooks:

- [`./models/notification-config.ts`](./models/notification-config.ts)

TRPC wrapper:

- [`./app-notification-config.ts`](./app-notification-config.ts)

Actual implementation:

- [`getLocalNotificationConfig(...)`](./app-notifications.ts)
- [`setLocalNotificationConfig(...)`](./app-notifications.ts)
- [`resendLocalNotificationVerification(...)`](./app-notifications.ts)
- [`removeLocalNotificationConfig(...)`](./app-notifications.ts)

This means config changes are:

- applied optimistically in the desktop store
- then synced through the same unified notify-service API as read-state changes

## UI Layer

Main notifications page:

- [`./pages/notifications.tsx`](./pages/notifications.tsx)

Shared helpers used by desktop UI:

- routing and open-and-mark-read:
  [`../../../packages/shared/src/models/notification-helpers.ts`](../../../packages/shared/src/models/notification-helpers.ts)
- read detection:
  [`../../../packages/shared/src/models/notification-read-logic.ts`](../../../packages/shared/src/models/notification-read-logic.ts)

Even though desktop plumbing differs from web, the UI meaning of a `NotificationPayload` stays aligned because those
helpers are shared.

## Tests Worth Reading

The most useful tests for the current design are:

- [`./__tests__/app-notification-read-state.test.ts`](./__tests__/app-notification-read-state.test.ts)
- [`./__tests__/app-notification-inbox.test.ts`](./__tests__/app-notification-inbox.test.ts)

They confirm the current protocol more accurately than the older architecture text did:

- desktop fetches `get-notification-state`
- desktop applies local optimistic actions
- desktop then sends `apply-notification-actions`

## Things That Look Transitional

### The wrapper filenames imply a larger split than still exists

Files like:

- [`./app-notification-config.ts`](./app-notification-config.ts)
- [`./app-notification-read-state.ts`](./app-notification-read-state.ts)
- [`./app-notification-inbox.ts`](./app-notification-inbox.ts)

sound like separate implementations, but today they are mostly routing layers into
[`./app-notifications.ts`](./app-notifications.ts).

### Older desktop docs described a separate inbox ingestion protocol

That is no longer the active design. The current code path syncs the whole canonical state snapshot through:

- [`../../../packages/shared/src/models/notification-service.ts`](../../../packages/shared/src/models/notification-service.ts)

### Desktop is still not a pure view of the notify service

Because it is local-first, the renderer can show:

- optimistic state not yet acknowledged by the server
- stale server data when sync is failing

That is intentional, but it matters when debugging mismatches between desktop and the notify service.
