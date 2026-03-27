# Web Notifications Architecture

This app does not maintain its own notification backend. It signs requests in the browser and talks directly to the
notify service.

The key pieces are:

- auth and local identity in `auth.tsx`, `auth-session.ts`, and `local-db.ts`
- notify-service hooks in `web-notifications.ts`
- notifications page UI in `routes/hm.notifications.tsx`
- legacy public email signup in `email-notifications.tsx`

## Where the notify host comes from

For delegated web auth, the notify host is not hardcoded into the notifications page. It comes from the vault auth
callback.

The path is:

1. vault callback data includes `notifyServerUrl`
   - see `@shm/shared/src/hmauth.ts`
2. `auth-session.ts` validates that URL during callback handling
3. `routes/hm.auth.callback.tsx` stores it via `writeLocalKeys(...)`
4. `local-db.ts` persists it in IndexedDB alongside the local session key pair
5. `auth.tsx` exposes it through `useLocalKeyPair()`
6. `web-notifications.ts` reads it through `useWebNotifyServiceHost()`

That means the browser is effectively configured by the authenticated vault session, not just by a build-time env var.

## Identity and signing model

The web app signs notify-service requests locally in the browser.

`web-notifications.ts` builds a `NotificationSigner` by:

- reading the local key pair from `useLocalKeyPair()`
- exporting a compressed public key through `preparePublicKey()`
- using `crypto.subtle.sign(...)` on the local private key

If the session is delegated, it also passes `accountUid` so the notify service can verify that the session key is
allowed to act for the real account.

This mirrors the server-side expectation in the notify app:

- signer key proves possession
- optional `accountUid` proves delegation

## Shared protocol layer

Most of the browser-side protocol is not in the web app itself. It lives in `@shm/shared/src/models/notifications.ts`.

That shared layer handles:

- CBOR request encoding
- request signing shape
- POSTing to `/hm/api/notification-config`
- POSTing to `/hm/api/notification-read-state`
- POSTing to `/hm/api/notification-inbox`

The web app then wraps those shared hooks with browser-specific identity lookup.

## Inbox flow on the web

`useWebNotificationInbox()` in `web-notifications.ts` is thin:

- get notify host from local identity
- get signer from local identity
- call shared `useNotificationInbox()`

The shared hook does two things in order:

1. call `register-inbox`
2. fetch the inbox page

So the first page load both enrolls the account for server-side inbox persistence and immediately reads from it.

The actual notifications page lives in `routes/hm.notifications.tsx`.

That page:

- requires a local key pair
- fetches inbox items from the notify service
- fetches read state from the notify service
- filters unread items client-side
- uses `markNotificationReadAndNavigate()` to open an item and mark it read

## Read-state flow on the web

The browser treats the notify service as the source of truth for read state.

`web-notifications.ts` provides three mutations:

- mark one event read
- mark one event unread
- mark all loaded events read

Those mutations use pure helpers from `@shm/shared/src/models/notification-read-logic.ts` to compute the next snapshot
locally first, then send a merged snapshot to the server.

The pattern is:

1. read current query-cached state
2. compute next state locally
3. apply optimistic update to React Query
4. send `merge-notification-read-state`
5. invalidate the query

The read-state model is watermark-based:

- `markAllReadAtMs` marks everything at or before a timestamp as read
- `readEvents` keeps explicit read markers above that watermark

That keeps "mark all as read" cheap without needing one row per notification.

## Email config flow on the web

The newer account-owned email config uses the same signed notify-service channel as the inbox and read state.

`web-notifications.ts` exposes wrappers for:

- get config
- set config
- resend verification
- remove config

This is the path meant for "my notifications" tied to the signed-in account.

## The older public signup flow still exists

Separate from the signed notification config, `email-notifications.tsx` still posts to `/hm/api/public-subscribe`.

That flow:

- uses `NOTIFY_SERVICE_HOST` from env
- sends plain JSON, not signed CBOR
- creates legacy `email_subscriptions`
- is used by prompts like the commenting flow

So on the web there are two different ways to "turn on notifications":

- signed account-owned config, used by the notifications page
- unsigned public email signup, used by prompt-style subscription UI

That split matches the two subscription systems in the notify service.

## Navigation and presentation

The page UI is intentionally thin. Most of the meaning of a notification comes from shared helpers:

- `notificationRouteForPayload()`
- `notificationTitle()`
- `getMaxLoadedNotificationEventAtMs()`
- `markNotificationReadAndNavigate()`

Those live in `@shm/shared/src/models/notification-helpers.ts`.

That keeps web and desktop mostly aligned on:

- titles
- routing
- read/unread semantics

## What is confusing on the web side

### The web app uses both signed and unsigned notification APIs

The newer notifications page uses:

- signed CBOR requests
- delegated identity
- account-owned notify host from vault callback

The older email signup form uses:

- plain JSON
- build-time `NOTIFY_SERVICE_HOST`
- no account signature

Both are valid code paths today, but they are not the same system.

### The notify host is session-derived, not page-derived

That is probably correct, but it is easy to miss.

If a user changes vaults or session state, the notify service host effectively changes with the stored auth session. The
page itself does not derive it from the current site host.

### The browser assumes the server has already built the inbox

The web app does not classify raw activity feed events itself. It only consumes `NotificationPayload` rows already
persisted by the notify service. That keeps the browser simple, but it also means any server-side notifier gap shows up
as "missing notifications" in the web UI.
