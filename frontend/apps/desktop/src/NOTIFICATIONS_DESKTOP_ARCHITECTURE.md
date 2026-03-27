# Desktop Notifications Architecture

The desktop app does not use the browser-style shared hooks directly. Instead, it keeps a local notification layer in
the Electron main process and syncs parts of that state with the notify service.

There are three desktop-specific pieces:

- local inbox ingestion in `app-notification-inbox.ts`
- local read-state storage and sync in `app-notification-read-state.ts`
- signed email-config proxy in `app-notification-config.ts`

The UI page in `pages/notifications.tsx` talks to those services through TRPC wrappers in `models/notification-*`.

## Why desktop is more complicated than web

The web app can treat the notify service as the whole backend.

The desktop app has extra requirements:

- it owns local signing through the daemon
- it can keep local state when the notify service is unavailable
- it can optionally synthesize notifications from the daemon activity feed
- it has to handle multiple local accounts

So desktop is intentionally more stateful and more redundant.

## Startup and lifecycle

Notification services are started from `app-api.ts`, but only after the daemon is ready.

Once ready, desktop starts:

- `startNotificationReadBackgroundSync()`
- `startNotificationInboxBackgroundIngestor()`

That daemon dependency matters because desktop signs notify-service requests through:

- `grpcClient.daemon.signData(...)`

The browser signs directly with WebCrypto. Desktop signs via the local daemon.

## Desktop read-state architecture

`app-notification-read-state.ts` keeps the canonical desktop read state in the Electron app store.

Per account it stores:

- `markAllReadAtMs`
- `stateUpdatedAtMs`
- `readEvents`
- `dirty`
- `lastSyncAtMs`
- `lastSyncError`

### Local-first behavior

The UI never writes directly to the notify service. It mutates local state first.

The mutations are:

- `markEventRead`
- `markEventUnread`
- `markAllRead`

Each mutation:

1. updates the local store
2. bumps `stateUpdatedAtMs`
3. marks the state dirty
4. schedules a debounced sync

The page in `pages/notifications.tsx` reads local state through `models/notification-read-state.ts`.

### Sync protocol

When sync runs, desktop does a two-step merge:

1. GET remote read state
2. merge local and remote
3. POST merged snapshot back with `merge-notification-read-state`
4. re-merge the server response with any local changes that happened during the POST

The merge rules are implemented in `mergeLocalAndRemoteState()`.

The important rule is:

- newer `stateUpdatedAtMs` wins

But the merge is more nuanced than simple overwrite:

- the watermark is merged with last-writer-wins semantics
- read events are pruned under the watermark
- newer local intent can suppress older remote per-event reads

The tests in `__tests__/app-notification-read-state.test.ts` are useful here because they describe the intended LWW
behavior much more clearly than the runtime code alone.

### Host changes

`app-gateway-settings.ts` stores the notify host in the Electron store. When it changes, it calls
`handleNotifyServiceHostChanged()`, which schedules a new sync for known accounts.

That means read state is sticky to the desktop app even if the notification server host changes underneath it.

## Desktop inbox architecture

The inbox path is separate from read state.

`app-notification-inbox.ts` keeps a local cache per account:

- `items`
- `newestServerEventAtMs`

It also stores:

- `registeredAccounts`
- `registeredHost`
- `cursorEventId`
- poll timestamps and errors

### Server-backed inbox flow

The normal server-backed flow is:

1. list local daemon keys
2. ensure each account has a local inbox bucket
3. detect notify-host changes
4. register each account with the notify service inbox
5. fetch pages incrementally from `/hm/api/notification-inbox`
6. merge new items into local cached inbox state

The notify service is treated as the producer of notification payloads, and desktop is mostly a caching client here.

### Optional local fallback

There is also a fallback path behind `SEED_DESKTOP_LOCAL_NOTIFICATION_FALLBACK=1`.

When enabled, desktop:

- reads the daemon activity feed directly
- classifies events locally with `classifyNotificationEvent()`
- converts them into `NotificationPayload`
- merges them with server items

This fallback exists because the server-backed inbox has been under active development. It is useful, but it adds
another full notification pipeline to reason about.

### Merge behavior

`mergeNotifications()` combines:

- existing cached items
- local fallback items
- server items

Merge priority is:

1. existing cached items
2. local fallback items
3. server items win on duplicate IDs

That ordering makes sense operationally, but it also means the desktop inbox is not a pure view of the notify service.

## Desktop email config path

Desktop also proxies the signed email-config API through the main process.

`app-notification-config.ts`:

- derives the signer public key from the account UID
- asks the daemon to sign the request
- calls the notify service
- normalizes connection failures into user-facing "not connected" behavior

The UI in `pages/notifications.tsx` uses that through `models/notification-config.ts`.

So unlike web:

- web signs directly in the browser
- desktop signs in the main process through the daemon

## Shared UI logic

Even though desktop has custom backend plumbing, it still reuses shared presentation logic:

- `isNotificationEventRead`
- `notificationRouteForPayload`
- `notificationTitle`
- `markNotificationReadAndNavigate`

That is why the desktop page and the web page look structurally similar even though the data flow underneath them is
different.

## What is confusing on the desktop side

### There are two inbox implementations layered together

Desktop can consume:

- server-built inbox items
- locally synthesized fallback items

Those are merged into one list. That is pragmatic, but it makes it harder to answer "where did this notification come
from?" without reading the main-process code.

### Desktop duplicates protocol logic that also exists in shared/web code

There is similar logic for:

- signed requests
- host resolution
- notification queries

across:

- `@shm/shared/src/models/notifications.ts`
- `app-notification-config.ts`
- `app-notification-read-state.ts`
- `app-notification-inbox.ts`

That duplication may be justified by Electron constraints, but it definitely raises the maintenance cost.

### The inbox response encoding looks inconsistent in code

I do not fully understand this part yet.

`app-notification-inbox.ts` sends a CBOR request, then reads the response as `arrayBuffer()` and tries to
`cborDecode(...)` it. But the notify service route in `frontend/apps/notify/app/routes/hm.api.notification-inbox.tsx`
returns Remix `json(...)`, not CBOR.

Possibilities:

- there is an adapter I missed
- this path is stale
- this path is only lightly exercised compared with read-state/config

I did not validate that end-to-end, so I would treat it as suspicious rather than conclusively broken.

### Host changes reset registration state but keep inbox items

When the notify host changes, desktop clears:

- `registeredAccounts`
- `newestServerEventAtMs`

but keeps cached `items`

That is reasonable for preserving UI continuity, but it means the local inbox temporarily contains data from the old
host until new polling catches up.
