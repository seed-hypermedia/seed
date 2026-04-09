# Web Notifications Architecture

This document describes the current web client behavior. The canonical server-side map is:

- notify service:
  [`../../notify/app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md`](../../notify/app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md)

The short version is:

- the browser signs notification requests locally
- the notify-service host comes from the authenticated vault callback
- the web client talks to the unified signed endpoint at `/hm/api/notifications`
- the older public email-signup flow still exists separately

## Current Request Path

The web app does not maintain its own notification backend. It talks directly to the notify service.

The active stack is:

- browser-specific signer/host logic: [`./web-notifications.ts`](./web-notifications.ts)
- shared signed transport:
  [`../../../packages/shared/src/models/notification-service.ts`](../../../packages/shared/src/models/notification-service.ts)
- shared snapshot/actions hooks:
  [`../../../packages/shared/src/models/notifications.ts`](../../../packages/shared/src/models/notifications.ts)
- page UI: [`./notifications-page-content.tsx`](./notifications-page-content.tsx)

Current first-party requests go to:

- [`../../notify/app/routes/hm.api.notifications.tsx`](../../notify/app/routes/hm.api.notifications.tsx)

The older per-feature routes described in previous docs are no longer the main web path.

## Where the Notify Host Comes From

The notify host is session-derived, not page-derived.

Flow:

1. the vault callback payload includes `notifyServerUrl`
   - parsed and validated in [`./auth-session.ts`](./auth-session.ts)
2. the callback route stores it via [`writeLocalKeys(...)`](./local-db.ts)
   - route: [`./routes/hm.auth.callback.tsx`](./routes/hm.auth.callback.tsx)
3. local identity is exposed through [`useLocalKeyPair()`](./auth.tsx)
4. [`useWebNotifyServiceHost()`](./web-notifications.ts) reads `keyPair.notifyServerUrl`

That means notification routing follows the authenticated vault session.

## Identity, Signing, and Delegation

The browser signs notification requests locally using Web Crypto.

Relevant code:

- public-key compression: [`./auth-utils.ts`](./auth-utils.ts)
- local identity hook: [`./auth.tsx`](./auth.tsx)
- browser notification signer: [`./web-notifications.ts`](./web-notifications.ts)

The signer built in [`useWebNotificationSigner()`](./web-notifications.ts):

- exports the public key with `preparePublicKey(...)`
- signs CBOR bytes with `crypto.subtle.sign(...)`
- includes `accountUid` when the session is delegated

Delegated sessions come from the vault callback flow in:

- [`./auth-session.ts`](./auth-session.ts)
- [`./routes/hm.auth.callback.tsx`](./routes/hm.auth.callback.tsx)

On the server, delegation is resolved by:

- [`../../notify/app/verify-delegation.ts`](../../notify/app/verify-delegation.ts)

## Shared Notification Protocol

The web app reuses the shared protocol layer rather than implementing each endpoint itself.

Shared transport:

- [`../../../packages/shared/src/models/notification-service.ts`](../../../packages/shared/src/models/notification-service.ts)

Shared state/actions:

- [`../../../packages/shared/src/models/notification-state.ts`](../../../packages/shared/src/models/notification-state.ts)
- [`../../../packages/shared/src/models/notifications.ts`](../../../packages/shared/src/models/notifications.ts)

The shared layer:

- builds signed CBOR requests
- posts to `/hm/api/notifications`
- fetches the full canonical snapshot
- applies state mutations through `apply-notification-actions`

## Inbox Flow

The inbox page is:

- [`./notifications-page-content.tsx`](./notifications-page-content.tsx)

Current behavior:

1. load account identity from [`useLocalKeyPair()`](./auth.tsx)
2. resolve notify host from the stored session
3. create a browser signer in [`./web-notifications.ts`](./web-notifications.ts)
4. fetch the canonical snapshot with [`useWebNotificationInbox()`](./web-notifications.ts)
5. render `NotificationPayload` rows returned by the server

Important point:

- the browser does not classify raw daemon events
- it only renders already-persisted `NotificationPayload` rows from the notify service

Routing and display meaning come from shared helpers:

- route builder:
  [`../../../packages/shared/src/models/notification-helpers.ts`](../../../packages/shared/src/models/notification-helpers.ts)
- read logic:
  [`../../../packages/shared/src/models/notification-read-logic.ts`](../../../packages/shared/src/models/notification-read-logic.ts)

## Read-State Flow

The browser treats the notify service as canonical state, but applies optimistic UI updates locally.

Optimistic mutation logic lives in:

- [`useApplyWebNotificationActions()` in `./web-notifications.ts`](./web-notifications.ts)

Pattern:

1. read the current cached notification snapshot
2. reduce the pending action locally with
   [`reduceNotificationState(...)`](../../../packages/shared/src/models/notification-state.ts)
3. update the React Query cache optimistically
4. send `apply-notification-actions`
5. invalidate the canonical query

Read/unread semantics come from:

- [`../../../packages/shared/src/models/notification-read-logic.ts`](../../../packages/shared/src/models/notification-read-logic.ts)

## Email Config Flow

The signed email-config path uses the same unified notification-state API as the inbox and read state.

Hooks:

- [`useWebNotificationConfig()`](./web-notifications.ts)
- [`useWebSetNotificationConfig()`](./web-notifications.ts)
- [`useWebResendNotificationConfigVerification()`](./web-notifications.ts)
- [`useWebRemoveNotificationConfig()`](./web-notifications.ts)

Those hooks delegate to:

- [`../../../packages/shared/src/models/notifications.ts`](../../../packages/shared/src/models/notifications.ts)

The notify service then persists config and verification state via:

- [`../../notify/app/notification-state.ts`](../../notify/app/notification-state.ts)

## Legacy Public Signup Flow Still Exists

Separate from the signed account-owned state, the web app still has a public email-signup form:

- [`./email-notifications.tsx`](./email-notifications.tsx)

That path:

- uses `NOTIFY_SERVICE_HOST` from environment
- posts JSON, not signed CBOR
- hits [`../../notify/app/routes/hm.api.public-subscribe.$.tsx`](../../notify/app/routes/hm.api.public-subscribe.$.tsx)
- creates legacy `email_subscriptions`

This flow is still used by prompt-style UI such as:

- [`./commenting.tsx`](./commenting.tsx)

So the web app currently has two distinct ways to "turn on notifications":

1. signed account-owned notification state
2. unsigned public email subscription

## Things That Look Transitional

### Previous docs overemphasized the old per-feature routes

Current first-party web code uses:

- [`../../../packages/shared/src/models/notification-service.ts`](../../../packages/shared/src/models/notification-service.ts)
- `/hm/api/notifications`

The vault client still uses:

- `/hm/api/notification-config`
- `/hm/api/notification-inbox`

So those routes are not dead notify-service APIs. They are just not part of the current first-party web notifications
page path.

### The notify host is stored with local identity

That is probably intentional, but it means notification behavior depends on session state, not just the current site
URL.

### The legacy public-signup path is still live

That is not dead code. It is a genuinely separate product path and makes the web-side story more confusing unless it is
called out explicitly.
