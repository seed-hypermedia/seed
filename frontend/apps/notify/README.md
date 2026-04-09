# Notifications + Email System Overview

This directory is the operational center of Seed's notification system, but the full system spans five places:

- the notify service runtime in [`./app`](./app)
- the shared signed notification protocol in
  [`../../packages/shared/src/models/notification-service.ts`](../../packages/shared/src/models/notification-service.ts)
- the web client in [`../web/app`](../web/app)
- the desktop client in [`../desktop/src`](../desktop/src)
- the email renderer/templates in [`../emails`](../emails)

If you only read one file first, read
[`./app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md`](./app/NOTIFICATIONS_SERVICE_ARCHITECTURE.md). That is the canonical
service-side map. The client-specific docs are:

- review + restructuring memo: [`./NOTIFICATIONS_REVIEW.md`](./NOTIFICATIONS_REVIEW.md)
- web: [`../web/app/NOTIFICATIONS_WEB_ARCHITECTURE.md`](../web/app/NOTIFICATIONS_WEB_ARCHITECTURE.md)
- desktop:
  [`../desktop/src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md`](../desktop/src/NOTIFICATIONS_DESKTOP_ARCHITECTURE.md)

## Current Mental Model

There are two real notification products living in the same service:

1. Signed, account-owned notifications

   - canonical state lives in SQLite via [`./app/db.ts`](./app/db.ts)
   - state is read and mutated through [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx)
   - clients use the shared protocol in
     [`../../packages/shared/src/models/notification-service.ts`](../../packages/shared/src/models/notification-service.ts)
   - this drives inbox, read state, verification, and immediate mention/reply/discussion emails

2. Legacy public email subscriptions
   - created through [`./app/routes/hm.api.public-subscribe.$.tsx`](./app/routes/hm.api.public-subscribe.$.tsx)
   - stored in [`email_subscriptions`](./app/db.ts)
   - managed by token routes and UI in
     [`./app/routes/hm.api.email-notif-token.tsx`](./app/routes/hm.api.email-notif-token.tsx) and
     [`./app/routes/hm.email-notifications.tsx`](./app/routes/hm.email-notifications.tsx)
   - this drives site-level batch emails

Those two systems overlap in the notify database and settings UI, but they are not the same protocol and they do not
produce the same notification shapes.

## End-to-End Flow

### 1. Service startup

The notify app boots in [`./app/entry.server.tsx`](./app/entry.server.tsx).

- [`initDatabase()`](./app/db.ts) opens SQLite and runs migrations.
- [`initEmailNotifier()`](./app/email-notifier.ts) starts the background event-processing loops.

### 2. Event source

The service does not invent notifications from request-time client data. It reads the daemon activity feed and related
daemon APIs:

- activity feed: [`grpcClient.activityFeed.listEvents`](./app/email-notifier.ts)
- comments/resources/accounts: [`requestAPI()`](./app/notify-request.ts)
- delegated auth capability checks: [`grpcClient.accessControl.listCapabilitiesForDelegate`](./app/verify-delegation.ts)

### 3. Event classification

The notifier loop in [`./app/email-notifier.ts`](./app/email-notifier.ts) converts daemon events into higher-level
notification reasons:

- routing by delivery kind: [`./app/notification-routing.ts`](./app/notification-routing.ts)
- comment classification:
  [`../../packages/shared/src/models/notification-event-classifier.ts`](../../packages/shared/src/models/notification-event-classifier.ts)
- persisted inbox payload shape:
  [`../../packages/shared/src/models/notification-payload.ts`](../../packages/shared/src/models/notification-payload.ts)

### 4. Email delivery

Emails are rendered by [`../emails/notifier.tsx`](../emails/notifier.tsx) and sent by
[`./app/mailer.ts`](./app/mailer.ts).

- immediate emails: `mention`, `reply`, `discussion`
- batch emails: `site-new-discussion`, intended `site-doc-update`
- verification email: `createNotificationVerificationEmail(...)`
- welcome email for public signup: `createWelcomeEmail(...)`

### 5. Canonical notification state API

The first-party clients now use one signed route:

- server route: [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx)
- server reducer/persistence: [`./app/notification-state.ts`](./app/notification-state.ts)
- client transport:
  [`../../packages/shared/src/models/notification-service.ts`](../../packages/shared/src/models/notification-service.ts)
- shared reducer/state model:
  [`../../packages/shared/src/models/notification-state.ts`](../../packages/shared/src/models/notification-state.ts)

That route returns one snapshot containing:

- inbox page
- email config state
- read state

### 6. Web client

The web client signs requests in-browser with the local session key:

- signer + host lookup: [`../web/app/web-notifications.ts`](../web/app/web-notifications.ts)
- callback stores `notifyServerUrl`: [`../web/app/routes/hm.auth.callback.tsx`](../web/app/routes/hm.auth.callback.tsx)
- session parsing/validation: [`../web/app/auth-session.ts`](../web/app/auth-session.ts)
- local key storage: [`../web/app/local-db.ts`](../web/app/local-db.ts)
- page UI: [`../web/app/notifications-page-content.tsx`](../web/app/notifications-page-content.tsx)

### 7. Desktop client

The desktop app keeps a local optimistic notification store and syncs it with the same signed service API:

- shared local store + sync engine: [`../desktop/src/app-notifications.ts`](../desktop/src/app-notifications.ts)
- daemon signing bridge:
  [`../../../backend/api/daemon/v1alpha/daemon.go`](../../../backend/api/daemon/v1alpha/daemon.go)
- page UI: [`../desktop/src/pages/notifications.tsx`](../desktop/src/pages/notifications.tsx)

### 8. Email-management links

Email links are not just static landing pages. They can mutate state:

- verify email: [`./app/routes/hm.notification-email-verify.tsx`](./app/routes/hm.notification-email-verify.tsx)
- mark notification read before redirect:
  [`./app/routes/hm.notification-read-redirect.tsx`](./app/routes/hm.notification-read-redirect.tsx)
- one-click unsubscribe: [`./app/routes/hm.api.unsubscribe.tsx`](./app/routes/hm.api.unsubscribe.tsx)

## Things That Look Transitional

These are worth treating carefully before relying on them as active design:

- The old signed per-feature routes still exist in
  [`./app/routes/hm.api.notification-config.tsx`](./app/routes/hm.api.notification-config.tsx),
  [`./app/routes/hm.api.notification-read-state.tsx`](./app/routes/hm.api.notification-read-state.tsx), and
  [`./app/routes/hm.api.notification-inbox.tsx`](./app/routes/hm.api.notification-inbox.tsx), but the first-party web
  and desktop clients use the unified route in
  [`./app/routes/hm.api.notifications.tsx`](./app/routes/hm.api.notifications.tsx).
- `notifyOwnedDocChange` is exposed in schema, UI, and legacy subscription state, but the actual notifier still has a
  TODO in [`./app/email-notifier.ts`](./app/email-notifier.ts), so document-update delivery is not wired end to end.
- The `inbox_registration` table and helper functions exist in [`./app/db.ts`](./app/db.ts), but there are no live call
  sites, and the old `register-inbox` action currently does not write anything.
- [`email-notification-signing-notes.md`](../../../email-notification-signing-notes.md) is historical and no longer
  matches the current unified API shape.
- [`../emails/notifier.tsx`](../emails/notifier.tsx) exports `createDesktopNotificationsEmail(...)`, but there are no
  production call sites in this repo.
