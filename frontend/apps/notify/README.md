# Notifications + Email System Overview

This directory is the operational center of Seed's notification system, but the full system spans five places:

- the notify service runtime in [`./app`](./app)
- the shared signed notification protocol in
  [`../../packages/shared/src/models/notification-service.ts`](../../packages/shared/src/models/notification-service.ts)
- the web client in [`../web/app`](../web/app)
- the desktop client in [`../desktop/src`](../desktop/src)
- the email renderer/templates in [`../emails`](../emails)

The published description of how the service, the clients and the read-state rules fit together is
[`hypermedia/apps/notify.md`](../../../hypermedia/apps/notify.md). This README is the file-by-file map.

## Current Mental Model

There are two notification products, exposed through three active API surfaces:

1. Unified signed notification state for web and desktop

   - canonical state lives in SQLite via [`./app/db.ts`](./app/db.ts)
   - state is read and mutated through [`./app/routes/notifications.ts`](./app/routes/notifications.ts)
   - clients use the shared protocol in
     [`../../packages/shared/src/models/notification-service.ts`](../../packages/shared/src/models/notification-service.ts)
   - this drives inbox, read state, verification, and immediate mention/reply/discussion emails

2. Signed vault registration/config APIs

   - registration + config routes are [`./app/routes/notification-inbox.ts`](./app/routes/notification-inbox.ts) and
     [`./app/routes/notification-config.ts`](./app/routes/notification-config.ts)
   - the vault client uses these dedicated routes from
     [`../../vault/src/frontend/notification-api.ts`](../../vault/src/frontend/notification-api.ts)
   - this surface preserves explicit registration state and trusted `emailPrevalidation`

3. Legacy public email subscriptions
   - created through [`./app/routes/public-subscribe.ts`](./app/routes/public-subscribe.ts)
   - stored in [`email_subscriptions`](./app/db.ts)
   - managed by the token route [`./app/routes/email-notif-token.ts`](./app/routes/email-notif-token.ts), which the web
     app's `/hm/email-notifications` settings page calls
   - this drives site-level batch emails

Those two systems overlap in the notify database and settings UI, but they are not the same protocol and they do not
produce the same notification shapes.

## End-to-End Flow

### 1. Service startup

Notify is a headless Bun service. It boots in [`./app/main.ts`](./app/main.ts).

- [`initDatabase()`](./app/db.ts) opens SQLite (`bun:sqlite`) and runs migrations.
- `Bun.serve` serves the route table in [`./app/routes.ts`](./app/routes.ts): every endpoint canonically under
  `/hm/api/notify/<leaf>`, the API leaves also at the legacy `/hm/api/<leaf>`.
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

- server route: [`./app/routes/notifications.ts`](./app/routes/notifications.ts)
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

### 7. Vault client

The vault frontend uses dedicated signed registration/config APIs:

- vault transport: [`../../vault/src/frontend/notification-api.ts`](../../vault/src/frontend/notification-api.ts)
- vault state: [`../../vault/src/frontend/store.ts`](../../vault/src/frontend/store.ts)
- vault UI:
  [`../../vault/src/frontend/components/AccountNotificationsSection.tsx`](../../vault/src/frontend/components/AccountNotificationsSection.tsx)

That flow still depends on:

- [`./app/routes/notification-inbox.ts`](./app/routes/notification-inbox.ts)
- [`./app/routes/notification-config.ts`](./app/routes/notification-config.ts)

### 8. Desktop client

The desktop app keeps a local optimistic notification store and syncs it with the same signed service API:

- shared local store + sync engine: [`../desktop/src/app-notifications.ts`](../desktop/src/app-notifications.ts)
- daemon signing bridge:
  [`../../../backend/api/daemon/v1alpha/daemon.go`](../../../backend/api/daemon/v1alpha/daemon.go)
- page UI: [`../desktop/src/pages/notifications.tsx`](../desktop/src/pages/notifications.tsx)

### 9. Email-management links

Email links are built in [`../emails/notify-links.ts`](../emails/notify-links.ts) from the origin of
`NOTIFY_SERVICE_HOST`. They can mutate state:

- verify email: [`./app/routes/verify-email.ts`](./app/routes/verify-email.ts)
- mark notification read before redirect: [`./app/routes/read-redirect.ts`](./app/routes/read-redirect.ts)
- one-click unsubscribe: [`./app/routes/unsubscribe.ts`](./app/routes/unsubscribe.ts)
- the settings page itself (`/hm/email-notifications?token=`) is served by the web app

## Tests

`pnpm test` runs vitest for the suites that mock the database, then `bun test` for `*.bun.test.ts`, which open a real
`bun:sqlite` database (including [`./app/routes.bun.test.ts`](./app/routes.bun.test.ts), which drives the whole route
table through `Bun.serve`).

## Things That Look Transitional

These are worth treating carefully before relying on them as active design:

- The standalone read-state route [`./app/routes/notification-read-state.ts`](./app/routes/notification-read-state.ts)
  still exists as a compatibility surface, but current first-party web, desktop, and vault flows do not use it directly.
- `notifyOwnedDocChange` is exposed in schema, UI, and legacy subscription state, but the actual notifier still has a
  TODO in [`./app/email-notifier.ts`](./app/email-notifier.ts), so document-update delivery is not wired end to end.
- The `inbox_registration` table and helper functions in [`./app/db.ts`](./app/db.ts) are active runtime state. They are
  used by unified snapshot reads, vault registration, and inbox-only subscription resolution in the notifier.
- [`../emails/notifier.tsx`](../emails/notifier.tsx) exports `createDesktopNotificationsEmail(...)`, but there are no
  production call sites in this repo.
